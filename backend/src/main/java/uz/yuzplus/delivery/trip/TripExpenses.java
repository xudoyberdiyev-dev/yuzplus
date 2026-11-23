package uz.yuzplus.delivery.trip;

import io.swagger.v3.oas.annotations.media.Schema;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import uz.yuzplus.finance.TripMoney;
import uz.yuzplus.finance.TripMoney.Kind;
import uz.yuzplus.shared.audit.AuditEntry;
import uz.yuzplus.shared.audit.AuditLog;
import uz.yuzplus.shared.error.YuzplusException;
import uz.yuzplus.shared.money.Money;
import uz.yuzplus.shared.security.Actor;

/**
 * Yo'l xarajatlari va reys avansi (HD2, egasi 23.11.2026, SPEC 5.4).
 * <ul>
 *   <li>Avans — kassir haydovchiga beradi (KO chiqim, {@link TripMoney#issueAdvance}).</li>
 *   <li>Xarajat — haydovchi yozadi (tur, summa, manba: avansdan / o'z pulidan / yig'ilgan naqddan; yoqilg'ida chek rasmi majburiy).</li>
 *   <li>Hisob-kitob — kassir naqd qabulida ({@link Trips#acceptTripCash}): har kutilayotgan xarajatni tasdiqlaydi yoki rad etadi;
 *       kutilgan = bekatlar naqdi + ochiq avans − tasdiqlangan xarajatlar. Rad etilgan xarajat summasi kutilganda qoladi —
 *       haydovchi topshirmasa, (b) «Haydovchi kamomadi».</li>
 * </ul>
 */
@Service
public class TripExpenses {

    private static final ZoneId TASHKENT = ZoneId.of("Asia/Tashkent");

    public enum Source { ADVANCE, OWN, COLLECTED }

    public enum Status { PENDING, APPROVED, REJECTED }

    public record TripAdvance(long id, String amount, String cashOp, @Schema(nullable = true) String note, String createdBy, Instant createdAt,
            boolean settled) {}

    public record TripExpense(long id, long tripId, String tripNumber, Kind kind, String amount, Source source, @Schema(nullable = true) String note,
            @Schema(nullable = true) String liters, @Schema(nullable = true) String price, @Schema(nullable = true) Integer odometer,
            @Schema(nullable = true) BigDecimal lat, @Schema(nullable = true) BigDecimal lng, Instant spentAt, Status status,
            @Schema(nullable = true) String rejectReason, @Schema(nullable = true) String decidedBy, boolean settled,
            @Schema(nullable = true) String cashOp, int photos, String driver, String vehicle) {}

    /** Reysning pul holati: avanslar, xarajatlar va ochiq (hali qabul qilinmagan) yig'indilar. */
    public record TripMoneyView(long tripId, String tripNumber, TripModels.TripStatus tripStatus, String driver, long branchId,
            List<TripAdvance> advances, List<TripExpense> expenses,
            @Schema(description = "Qabul qilinmagan avanslar jami") String advanceOpen,
            @Schema(description = "Qabul qilinmagan xarajatlar jami (kutilayotgan + hal qilingan)") String expensesOpen,
            int pending) {}

    public record NewExpense(Kind kind, Money amount, Source source, String note, BigDecimal liters, Money price, Integer odometer, BigDecimal lat,
            BigDecimal lng, Instant spentAt, UUID clientUuid) {}

    /** Kassir qarori (naqd qabulida). */
    public record Decision(long expenseId, boolean approve, String reason) {}

    /** Hisob-kitob natijasi: qaytgan avans, tasdiqlangan xarajatlar, KO raqamlari. */
    record Settled(Money advance, Money expenses, List<String> cashOps) {}

    /** Hisob-kitobdan oldingi holat (summa tekshiruvi uchun). */
    record Open(Money advance, Money approved, List<Long> advanceIds, List<Long> approvedIds, List<Long> rejectedIds) {}

    private final JdbcClient jdbc;
    private final TripMoney money;
    private final AuditLog audit;

    TripExpenses(JdbcClient jdbc, TripMoney money, AuditLog audit) {
        this.jdbc = jdbc;
        this.money = money;
        this.audit = audit;
    }

    private record TripRef(long id, String number, long branchId, long driverId, TripModels.TripStatus status) {}

    private TripRef lockTrip(long tripId) {
        return jdbc.sql("SELECT id, number, branch_id, driver_id, status FROM trip WHERE id = :t FOR UPDATE")
                .param("t", tripId)
                .query((rs, n) -> new TripRef(rs.getLong("id"), rs.getString("number"), rs.getLong("branch_id"), rs.getLong("driver_id"),
                        TripModels.TripStatus.valueOf(rs.getString("status"))))
                .optional()
                .orElseThrow(() -> YuzplusException.notFound("error.notFound"));
    }

    // ===== Avans =====

    /** Kassir haydovchiga avans beradi: reys «Rejalashtirilgan», «Yo'lda» yoki «Qaytish kutilmoqda». */
    @Transactional
    TripMoneyView issueAdvance(Actor actor, long tripId, long accountId, Money amount, String note) {
        TripRef t = lockTrip(tripId);
        if (!actor.canAccessBranch(t.branchId())) {
            throw YuzplusException.notFound("error.notFound");
        }
        if (t.status() == TripModels.TripStatus.DONE || t.status() == TripModels.TripStatus.CANCELLED) {
            throw YuzplusException.conflict("trip.advanceClosed");
        }
        if (!amount.isPositive()) {
            throw YuzplusException.badRequest("payment.amountInvalid");
        }
        String n = blank(note);
        TripMoney.Posted ko = money.issueAdvance(actor, t.branchId(), accountId, t.driverId(), t.number(), amount, n);
        long id = jdbc.sql("""
                INSERT INTO trip_advance (trip_id, amount, cash_op_id, note, created_by) VALUES (:t, :a, :c, :n, :by) RETURNING id""")
                .param("t", tripId).param("a", amount.amount()).param("c", ko.id()).param("n", n).param("by", actor.employeeId())
                .query(Long.class).single();
        audit.record(AuditEntry.of("trip.advance", "trip", tripId).change(null, Map.of("advance", id, "amount", amount.toString(), "ko", ko.number())));
        return view(actor, tripId, true);
    }

    // ===== Xarajat (haydovchi) =====

    /** Haydovchi xarajat yozadi (o'z reysi; «Rejalashtirilgan», «Yo'lda», «Qaytish kutilmoqda»). Takroriy {@code clientUuid} — o'sha yozuv. */
    @Transactional
    long addExpense(Actor actor, long tripId, NewExpense e) {
        if (e.clientUuid() != null) {
            Long existing = jdbc.sql("SELECT id FROM trip_expense WHERE client_uuid = :u AND trip_id = :t AND created_by = :by")
                    .param("u", e.clientUuid()).param("t", tripId).param("by", actor.employeeId()).query(Long.class).optional().orElse(null);
            if (existing != null) {
                return existing;
            }
        }
        TripRef t = lockTrip(tripId);
        if (!actor.canAccessBranch(t.branchId()) || t.driverId() != actor.employeeId()) {
            throw YuzplusException.forbidden("trip.notDriver");
        }
        if (t.status() == TripModels.TripStatus.DONE || t.status() == TripModels.TripStatus.CANCELLED) {
            throw YuzplusException.conflict("trip.expenseClosed");
        }
        if (e.amount() == null || !e.amount().isPositive()) {
            throw YuzplusException.badRequest("trip.expenseAmountInvalid");
        }
        String note = blank(e.note());
        if (e.kind() == Kind.OTHER && note == null) {
            throw YuzplusException.badRequest("trip.expenseNoteRequired");
        }
        Instant spent = e.spentAt() == null || e.spentAt().isAfter(Instant.now().plusSeconds(300)) ? Instant.now() : e.spentAt();
        boolean fuel = e.kind() == Kind.FUEL;
        long id = jdbc.sql("""
                INSERT INTO trip_expense (trip_id, kind, amount, source, note, liters, price, odometer, lat, lng, spent_at, client_uuid, created_by)
                VALUES (:t, :k, :a, :s, :n, :l, :p, :o, :lat, :lng, :at, :u, :by) RETURNING id""")
                .param("t", tripId).param("k", e.kind().name()).param("a", e.amount().amount()).param("s", e.source().name()).param("n", note)
                .param("l", fuel && e.liters() != null && e.liters().signum() > 0 ? e.liters() : null)
                .param("p", fuel && e.price() != null && e.price().isPositive() ? e.price().amount() : null)
                .param("o", e.odometer() != null && e.odometer() >= 0 ? e.odometer() : null)
                .param("lat", e.lat()).param("lng", e.lng())
                .param("at", java.sql.Timestamp.from(spent)).param("u", e.clientUuid()).param("by", actor.employeeId())
                .query(Long.class).single();
        audit.record(AuditEntry.of("trip.expense", "trip", tripId)
                .change(null, Map.of("expense", id, "kind", e.kind().name(), "amount", e.amount().toString(), "source", e.source().name())));
        return id;
    }

    private static final java.util.Set<String> IMAGE_TYPES = java.util.Set.of("image/jpeg", "image/png", "image/webp");

    /** Chek rasmi (hisob-kitobgacha). */
    @Transactional
    long addPhoto(Actor actor, long tripId, long expenseId, String contentType, byte[] data) {
        TripRef t = lockTrip(tripId);
        if (!actor.canAccessBranch(t.branchId()) || t.driverId() != actor.employeeId()) {
            throw YuzplusException.forbidden("trip.notDriver");
        }
        Long settled = jdbc.sql("SELECT coalesce(accept_id, 0) FROM trip_expense WHERE id = :e AND trip_id = :t")
                .param("e", expenseId).param("t", tripId).query(Long.class).optional()
                .orElseThrow(() -> YuzplusException.notFound("error.notFound"));
        if (settled != 0) {
            throw YuzplusException.conflict("trip.expenseClosed");
        }
        if (contentType == null || !IMAGE_TYPES.contains(contentType) || data.length == 0 || data.length > 5 * 1024 * 1024) {
            throw YuzplusException.badRequest("trip.photoInvalid");
        }
        return jdbc.sql("""
                INSERT INTO trip_expense_photo (expense_id, content_type, size_bytes, data) VALUES (:e, :ct, :sz, :d) RETURNING id""")
                .param("e", expenseId).param("ct", contentType).param("sz", data.length).param("d", data)
                .query(Long.class).single();
    }

    public record Photo(String contentType, byte[] data) {}

    /** Chek rasmi (oxirgisi). {@code wide} — kassir/rahbar; aks holda faqat o'z reysi. */
    @Transactional(readOnly = true)
    Photo photo(Actor actor, long expenseId, boolean wide) {
        return jdbc.sql("""
                SELECT p.content_type, p.data, t.branch_id, t.driver_id FROM trip_expense_photo p JOIN trip_expense x ON x.id = p.expense_id
                JOIN trip t ON t.id = x.trip_id WHERE p.expense_id = :e ORDER BY p.id DESC LIMIT 1""")
                .param("e", expenseId)
                .query((rs, n) -> actor.canAccessBranch(rs.getLong("branch_id")) && (wide || rs.getLong("driver_id") == actor.employeeId())
                        ? new Photo(rs.getString("content_type"), rs.getBytes("data"))
                        : null)
                .list().stream().filter(Objects::nonNull).findFirst()
                .orElseThrow(() -> YuzplusException.notFound("error.notFound"));
    }

    // ===== Ko'rish =====

    /** Reysning avans va xarajatlari. {@code wide} — kassir/rahbar; aks holda faqat o'z reysi (haydovchi). */
    @Transactional(readOnly = true)
    public TripMoneyView view(Actor actor, long tripId, boolean wide) {
        record H(long id, String number, String status, String driver, long driverId, long branchId) {}
        H h = jdbc.sql("""
                SELECT t.id, t.number, t.status, d.full_name, t.driver_id, t.branch_id FROM trip t JOIN employee d ON d.id = t.driver_id WHERE t.id = :t""")
                .param("t", tripId)
                .query((rs, n) -> new H(rs.getLong("id"), rs.getString("number"), rs.getString("status"), rs.getString("full_name"),
                        rs.getLong("driver_id"), rs.getLong("branch_id")))
                .optional()
                .filter(x -> actor.canAccessBranch(x.branchId()) && (wide || x.driverId() == actor.employeeId()))
                .orElseThrow(() -> YuzplusException.notFound("error.notFound"));
        List<TripAdvance> advances = jdbc.sql("""
                SELECT a.id, a.amount, c.number AS ko, a.note, e.full_name, a.created_at, a.accept_id
                FROM trip_advance a JOIN cash_op c ON c.id = a.cash_op_id JOIN employee e ON e.id = a.created_by WHERE a.trip_id = :t ORDER BY a.id""")
                .param("t", tripId)
                .query((rs, n) -> new TripAdvance(rs.getLong("id"), new Money(rs.getBigDecimal("amount")).toString(), rs.getString("ko"), rs.getString("note"),
                        rs.getString("full_name"), rs.getTimestamp("created_at").toInstant(), rs.getObject("accept_id") != null))
                .list();
        List<TripExpense> expenses = expenses("x.trip_id = :t", Map.of("t", tripId), 500);
        Money advOpen = advances.stream().filter(a -> !a.settled()).map(a -> Money.of(a.amount())).reduce(Money.ZERO, Money::plus);
        Money expOpen = expenses.stream().filter(x -> !x.settled() && x.status() != Status.REJECTED).map(x -> Money.of(x.amount()))
                .reduce(Money.ZERO, Money::plus);
        int pending = (int) expenses.stream().filter(x -> x.status() == Status.PENDING).count();
        return new TripMoneyView(h.id(), h.number(), TripModels.TripStatus.valueOf(h.status()), h.driver(), h.branchId(), advances, expenses,
                advOpen.toString(), expOpen.toString(), pending);
    }

    /** Kassa sahifasi: ochiq avans yoki hisob-kitob qilinmagan xarajati bor reyslar. */
    @Transactional(readOnly = true)
    List<TripMoneyView> open(Actor actor, Long branchId) {
        List<Long> ids = jdbc.sql("""
                SELECT t.id FROM trip t
                WHERE (CAST(:b AS BIGINT) IS NULL OR t.branch_id = :b)
                  AND (EXISTS (SELECT 1 FROM trip_advance a WHERE a.trip_id = t.id AND a.accept_id IS NULL)
                       OR EXISTS (SELECT 1 FROM trip_expense x WHERE x.trip_id = t.id AND x.accept_id IS NULL))
                ORDER BY t.id LIMIT 200""")
                .param("b", branchId)
                .query(Long.class)
                .list();
        List<TripMoneyView> out = new ArrayList<>();
        for (long id : ids) {
            try {
                out.add(view(actor, id, true));
            } catch (YuzplusException ignored) {
                // boshqa filial
            }
        }
        return out;
    }

    public record ExpenseGroup(String key, String label, int count, String total, String approved, @Schema(nullable = true) String liters,
            @Schema(nullable = true) Integer km, @Schema(nullable = true) String perKm) {}

    public record ExpenseReport(List<TripExpense> rows, List<ExpenseGroup> byDriver, List<ExpenseGroup> byVehicle, List<ExpenseGroup> byMonth,
            List<ExpenseGroup> byKind, String total, String approved, int pending) {}

    /** «Yo'l xarajatlari» sahifasi: ro'yxat va hisobot (haydovchi / mashina / oy / tur; 1 km ga so'm — odometr bo'yicha). */
    @Transactional(readOnly = true)
    ExpenseReport report(Actor actor, Long branchId, LocalDate from, LocalDate to, Long driverId, Long vehicleId, Status status) {
        if (branchId != null && !actor.canAccessBranch(branchId)) {
            throw YuzplusException.forbidden("auth.forbidden");
        }
        StringBuilder where = new StringBuilder("x.spent_at >= :f AND x.spent_at < :to");
        Map<String, Object> p = new java.util.HashMap<>();
        p.put("f", java.sql.Timestamp.from(from.atStartOfDay(TASHKENT).toInstant()));
        p.put("to", java.sql.Timestamp.from(to.plusDays(1).atStartOfDay(TASHKENT).toInstant()));
        if (branchId != null) {
            where.append(" AND t.branch_id = :b");
            p.put("b", branchId);
        }
        if (driverId != null) {
            where.append(" AND t.driver_id = :d");
            p.put("d", driverId);
        }
        if (vehicleId != null) {
            where.append(" AND t.vehicle_id = :v");
            p.put("v", vehicleId);
        }
        if (status != null) {
            where.append(" AND x.status = :s");
            p.put("s", status.name());
        }
        List<TripExpense> rows = expenses(where.toString(), p, 2000);
        Map<String, List<TripExpense>> drivers = new java.util.TreeMap<>();
        Map<String, List<TripExpense>> vehicles = new java.util.TreeMap<>();
        Map<String, List<TripExpense>> months = new java.util.TreeMap<>(java.util.Comparator.reverseOrder());
        Map<String, List<TripExpense>> kinds = new java.util.LinkedHashMap<>();
        for (Kind k : Kind.values()) {
            kinds.put(k.name(), new ArrayList<>());
        }
        java.time.format.DateTimeFormatter ym = java.time.format.DateTimeFormatter.ofPattern("yyyy-MM");
        for (TripExpense r : rows) {
            drivers.computeIfAbsent(r.driver(), k -> new ArrayList<>()).add(r);
            vehicles.computeIfAbsent(r.vehicle(), k -> new ArrayList<>()).add(r);
            months.computeIfAbsent(ym.format(r.spentAt().atZone(TASHKENT)), k -> new ArrayList<>()).add(r);
            kinds.get(r.kind().name()).add(r);
        }
        kinds.values().removeIf(List::isEmpty);
        Money total = sum(rows, false);
        Money approved = sum(rows, true);
        int pending = (int) rows.stream().filter(x -> x.status() == Status.PENDING).count();
        return new ExpenseReport(rows, groups(drivers, false), groups(vehicles, true), groups(months, true), groups(kinds, false), total.toString(),
                approved.toString(), pending);
    }

    private static Money sum(List<TripExpense> rows, boolean approvedOnly) {
        return rows.stream().filter(x -> !approvedOnly || x.status() == Status.APPROVED).map(x -> Money.of(x.amount())).reduce(Money.ZERO, Money::plus);
    }

    /** Guruhlar; {@code withKm} — odometr (max − min) va tasdiqlangan xarajat / km. */
    private static List<ExpenseGroup> groups(Map<String, List<TripExpense>> m, boolean withKm) {
        List<ExpenseGroup> out = new ArrayList<>();
        for (var e : m.entrySet()) {
            List<TripExpense> rs = e.getValue();
            Money approved = sum(rs, true);
            BigDecimal liters = rs.stream().filter(x -> x.liters() != null && x.status() != Status.REJECTED).map(x -> new BigDecimal(x.liters()))
                    .reduce(BigDecimal.ZERO, BigDecimal::add);
            Integer km = null;
            String perKm = null;
            if (withKm) {
                List<Integer> odo = rs.stream().map(TripExpense::odometer).filter(Objects::nonNull).toList();
                if (odo.size() >= 2) {
                    int d = java.util.Collections.max(odo) - java.util.Collections.min(odo);
                    if (d > 0) {
                        km = d;
                        perKm = new Money(approved.amount().divide(BigDecimal.valueOf(d), 2, java.math.RoundingMode.HALF_UP)).toString();
                    }
                }
            }
            out.add(new ExpenseGroup(e.getKey(), e.getKey(), rs.size(), sum(rs, false).toString(), approved.toString(),
                    liters.signum() > 0 ? liters.setScale(2, java.math.RoundingMode.HALF_UP).toPlainString() : null, km, perKm));
        }
        return out;
    }

    private List<TripExpense> expenses(String where, Map<String, ?> params, int limit) {
        var q = jdbc.sql("""
                SELECT x.id, x.trip_id, t.number AS trip, x.kind, x.amount, x.source, x.note, x.liters, x.price, x.odometer, x.lat, x.lng, x.spent_at,
                       x.status, x.reject_reason, db.full_name AS decided_by, x.accept_id, c.number AS ko, t.branch_id,
                       (SELECT count(*) FROM trip_expense_photo p WHERE p.expense_id = x.id) AS photos, d.full_name AS driver,
                       v.plate_number AS vehicle
                FROM trip_expense x JOIN trip t ON t.id = x.trip_id JOIN employee d ON d.id = t.driver_id JOIN vehicle v ON v.id = t.vehicle_id
                LEFT JOIN employee db ON db.id = x.decided_by LEFT JOIN cash_op c ON c.id = x.cash_op_id
                WHERE """ + where + " ORDER BY x.spent_at DESC, x.id DESC LIMIT " + limit);
        for (var e : params.entrySet()) {
            q = q.param(e.getKey(), e.getValue());
        }
        return q.query((rs, n) -> new TripExpense(rs.getLong("id"), rs.getLong("trip_id"), rs.getString("trip"), Kind.valueOf(rs.getString("kind")),
                        new Money(rs.getBigDecimal("amount")).toString(), Source.valueOf(rs.getString("source")), rs.getString("note"),
                        rs.getBigDecimal("liters") == null ? null : rs.getBigDecimal("liters").toPlainString(),
                        rs.getBigDecimal("price") == null ? null : new Money(rs.getBigDecimal("price")).toString(),
                        rs.getObject("odometer", Integer.class), rs.getBigDecimal("lat"), rs.getBigDecimal("lng"),
                        rs.getTimestamp("spent_at").toInstant(), Status.valueOf(rs.getString("status")), rs.getString("reject_reason"),
                        rs.getString("decided_by"), rs.getObject("accept_id") != null, rs.getString("ko"), rs.getInt("photos"),
                        rs.getString("driver"), rs.getString("vehicle")))
                .list();
    }

    // ===== Hisob-kitob (Trips.acceptTripCash ichida, reys qulflangan) =====

    /**
     * Ochiq avans va xarajatlarni qulflaydi va kassir qarorlarini tekshiradi: har kutilayotgan xarajatga qaror bo'lishi shart, rad etishda sabab
     * majburiy, yoqilg'ini chek rasmisiz tasdiqlab bo'lmaydi.
     */
    Open prepare(long tripId, List<Decision> decisions) {
        record A(long id, BigDecimal amount) {}
        List<A> advances = jdbc.sql("SELECT id, amount FROM trip_advance WHERE trip_id = :t AND accept_id IS NULL ORDER BY id FOR UPDATE")
                .param("t", tripId).query((rs, n) -> new A(rs.getLong("id"), rs.getBigDecimal("amount"))).list();
        record X(long id, BigDecimal amount, String kind, String status, boolean photo) {}
        List<X> expenses = jdbc.sql("""
                SELECT x.id, x.amount, x.kind, x.status, EXISTS (SELECT 1 FROM trip_expense_photo p WHERE p.expense_id = x.id) AS photo
                FROM trip_expense x WHERE x.trip_id = :t AND x.accept_id IS NULL ORDER BY x.id FOR UPDATE OF x""")
                .param("t", tripId)
                .query((rs, n) -> new X(rs.getLong("id"), rs.getBigDecimal("amount"), rs.getString("kind"), rs.getString("status"), rs.getBoolean("photo")))
                .list();
        Map<Long, Decision> byId = new java.util.HashMap<>();
        for (Decision d : decisions) {
            if (byId.put(d.expenseId(), d) != null || expenses.stream().noneMatch(x -> x.id() == d.expenseId())) {
                throw YuzplusException.badRequest("trip.expenseDecisionInvalid");
            }
        }
        Money adv = Money.ZERO;
        List<Long> advIds = new ArrayList<>();
        for (A a : advances) {
            adv = adv.plus(new Money(a.amount()));
            advIds.add(a.id());
        }
        Money approved = Money.ZERO;
        List<Long> ok = new ArrayList<>();
        List<Long> no = new ArrayList<>();
        for (X x : expenses) {
            Decision d = byId.get(x.id());
            if (d == null) {
                throw YuzplusException.badRequest("trip.expenseUndecided");
            }
            if (d.approve()) {
                if ("FUEL".equals(x.kind()) && !x.photo()) {
                    throw YuzplusException.conflict("trip.expensePhotoRequired");
                }
                approved = approved.plus(new Money(x.amount()));
                ok.add(x.id());
            } else {
                if (blank(d.reason()) == null) {
                    throw YuzplusException.badRequest("trip.expenseRejectReason");
                }
                no.add(x.id());
            }
        }
        return new Open(adv, approved, advIds, ok, no);
    }

    /**
     * Hisob-kitobni yozadi: avans qaytdi (KO kirim), tasdiqlangan xarajatlar (KO chiqim), rad etilganlar — sabab bilan. Kirimlar chiqimlardan
     * oldin (kassa qoldig'i manfiy bo'lmasin) — chaqiruvchi mijoz to'lovlaridan keyin chaqiradi.
     */
    Settled settle(Actor actor, long tripId, long acceptId, long accountId, Open o, List<Decision> decisions) {
        record T(String number, long branchId, long driverId) {}
        T t = jdbc.sql("SELECT number, branch_id, driver_id FROM trip WHERE id = :t").param("t", tripId)
                .query((rs, n) -> new T(rs.getString("number"), rs.getLong("branch_id"), rs.getLong("driver_id"))).single();
        List<String> kos = new ArrayList<>();
        if (o.advance().isPositive()) {
            kos.add(money.returnAdvance(actor, t.branchId(), accountId, t.driverId(), t.number(), o.advance()).number());
        }
        if (!o.advanceIds().isEmpty()) {
            jdbc.sql("UPDATE trip_advance SET accept_id = :a WHERE id IN (:ids)").param("a", acceptId).param("ids", o.advanceIds()).update();
        }
        Map<Long, Decision> byId = new java.util.HashMap<>();
        decisions.forEach(d -> byId.put(d.expenseId(), d));
        for (long id : o.approvedIds()) {
            record E(String kind, BigDecimal amount, String note) {}
            E e = jdbc.sql("SELECT kind, amount, note FROM trip_expense WHERE id = :id").param("id", id)
                    .query((rs, n) -> new E(rs.getString("kind"), rs.getBigDecimal("amount"), rs.getString("note"))).single();
            TripMoney.Posted ko = money.expense(actor, t.branchId(), accountId, t.driverId(), t.number(), Kind.valueOf(e.kind()), new Money(e.amount()), e.note());
            kos.add(ko.number());
            jdbc.sql("""
                    UPDATE trip_expense SET status = 'APPROVED', decided_by = :by, decided_at = now(), accept_id = :a, cash_op_id = :c WHERE id = :id""")
                    .param("by", actor.employeeId()).param("a", acceptId).param("c", ko.id()).param("id", id).update();
        }
        for (long id : o.rejectedIds()) {
            jdbc.sql("""
                    UPDATE trip_expense SET status = 'REJECTED', reject_reason = :r, decided_by = :by, decided_at = now(), accept_id = :a WHERE id = :id""")
                    .param("r", blank(byId.get(id).reason())).param("by", actor.employeeId()).param("a", acceptId).param("id", id).update();
        }
        if (!o.approvedIds().isEmpty() || !o.rejectedIds().isEmpty() || o.advance().isPositive()) {
            audit.record(AuditEntry.of("trip.expensesSettled", "trip", tripId).change(null, Map.of("advance", o.advance().toString(),
                    "approved", o.approved().toString(), "rejected", o.rejectedIds().size(), "ko", String.join(", ", kos))));
        }
        return new Settled(o.advance(), o.approved(), kos);
    }

    /** Reysda hisob-kitob qilinmagan avans yoki xarajat bormi. */
    boolean hasOpen(long tripId) {
        return jdbc.sql("""
                SELECT EXISTS (SELECT 1 FROM trip_advance WHERE trip_id = :t AND accept_id IS NULL)
                    OR EXISTS (SELECT 1 FROM trip_expense WHERE trip_id = :t AND accept_id IS NULL)""")
                .param("t", tripId).query(Boolean.class).single();
    }

    private static String blank(String s) {
        return s == null || s.isBlank() ? null : s.strip();
    }
}
