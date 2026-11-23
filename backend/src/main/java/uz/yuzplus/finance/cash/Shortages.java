package uz.yuzplus.finance.cash;

import io.swagger.v3.oas.annotations.media.Schema;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import uz.yuzplus.finance.CashierGuard;
import uz.yuzplus.finance.DriverShortages;
import uz.yuzplus.finance.account.Accounts;
import uz.yuzplus.finance.cash.CashModels.Direction;
import uz.yuzplus.finance.cash.CashModels.OpSource;
import uz.yuzplus.notification.Notifications;
import uz.yuzplus.shared.audit.AuditEntry;
import uz.yuzplus.shared.audit.AuditLog;
import uz.yuzplus.shared.error.YuzplusException;
import uz.yuzplus.shared.money.Money;
import uz.yuzplus.shared.security.Actor;

/**
 * Xodim kamomadi (KT1, SPEC 5.4) — faqat qo'shiladigan jurnal {@code employee_shortage} + qoldiq {@code employee_shortage_balance}
 * (jurnal bilan bitta tranzaksiyada, qoldiq qatori FOR UPDATE, manfiy bo'lmaydi). Kamomad: KO chiqim (kassaga tushmagan naqd).
 * Yopish: «Qaytardi» — KO kirim (kassir), «Hisobdan chiqarish» — sabab bilan (Direktor). Oylikdan ushlash yo'q (ish haqi moduli yo'q).
 */
@Service
class Shortages implements DriverShortages {

    static final String ITEM_OUT = "Haydovchi kamomadi";
    static final String ITEM_IN = "Haydovchi kamomadini qaytardi";

    enum Kind { SHORTAGE, REPAID, WRITTEN_OFF }

    record Balance(long employeeId, String employee, long branchId, String branch, String balance, String total, String closed) {}

    record Entry(long id, long employeeId, String employee, long branchId, Kind kind, String amount, @Schema(nullable = true) Long tripId,
            @Schema(nullable = true) String trip, @Schema(nullable = true) String cashOp, @Schema(nullable = true) String note, String createdBy,
            Instant createdAt) {}

    record Overview(List<Balance> balances, List<Entry> entries) {}

    private final JdbcClient jdbc;
    private final CashOps ops;
    private final Accounts accounts;
    private final CashierGuard cashiers;
    private final AuditLog audit;
    private final Notifications notifications;

    Shortages(JdbcClient jdbc, CashOps ops, Accounts accounts, CashierGuard cashiers, AuditLog audit, Notifications notifications) {
        this.jdbc = jdbc;
        this.ops = ops;
        this.accounts = accounts;
        this.cashiers = cashiers;
        this.audit = audit;
        this.notifications = notifications;
    }

    @Override
    @Transactional(propagation = Propagation.MANDATORY)
    public void recordTrip(Actor actor, long branchId, long employeeId, long accountId, long tripId, long acceptId, String tripNumber, Money amount,
            String note) {
        if (!amount.isPositive()) {
            throw new IllegalArgumentException("Kamomad musbat bo'lishi kerak");
        }
        Accounts.Account acc = cashAccount(branchId, accountId);
        String employee = employeeName(employeeId);
        CashOps.Posted ko = ops.system(actor, acc, Direction.OUT, ITEM_OUT, amount, employee, tripNumber + " · " + note, OpSource.SHORTAGE);
        long id = insert(branchId, employeeId, Kind.SHORTAGE, amount, tripId, acceptId, ko.id(), note, actor.employeeId());
        Money next = move(branchId, employeeId, amount);
        audit.record(AuditEntry.of("shortage.recorded", "employee_shortage", id)
                .change(null, Map.of("employee", employeeId, "trip", tripNumber, "amount", amount.toString(), "balance", next.toString(), "ko", ko.number())));
        notifications.notify("cash.approve", branchId, List.of(), notifications.message("shortage.recorded", "shortage.recorded", "/cash/shortages",
                "shortage.recorded:" + id, employee, amount.format(), tripNumber));
    }

    @Transactional
    String repay(Actor actor, long branchId, long employeeId, long accountId, Money amount, String note) {
        if (!actor.canAccessBranch(branchId)) {
            throw YuzplusException.notFound("error.notFound");
        }
        if (!amount.isPositive()) {
            throw YuzplusException.badRequest("payment.amountInvalid");
        }
        Accounts.Account acc = cashAccount(branchId, accountId);
        cashiers.check(acc.id());
        Money balance = lockBalance(branchId, employeeId);
        if (amount.compareTo(balance) > 0) {
            throw YuzplusException.conflict("shortage.exceedsBalance", balance.format());
        }
        String employee = employeeName(employeeId);
        String n = CashOps.blank(note);
        CashOps.Posted ko = ops.system(actor, acc, Direction.IN, ITEM_IN, amount, employee, n, OpSource.SHORTAGE);
        long id = insert(branchId, employeeId, Kind.REPAID, amount, null, null, ko.id(), n, actor.employeeId());
        Money next = move(branchId, employeeId, Money.ZERO.minus(amount));
        audit.record(AuditEntry.of("shortage.repaid", "employee_shortage", id)
                .change(Map.of("balance", balance.toString()), Map.of("balance", next.toString(), "ko", ko.number())));
        return ko.number();
    }

    @Transactional
    void writeOff(Actor actor, long branchId, long employeeId, Money amount, String reason) {
        if (!actor.canAccessBranch(branchId)) {
            throw YuzplusException.notFound("error.notFound");
        }
        if (!amount.isPositive()) {
            throw YuzplusException.badRequest("payment.amountInvalid");
        }
        String why = CashOps.blank(reason);
        if (why == null) {
            throw YuzplusException.badRequest("shortage.reasonRequired");
        }
        Money balance = lockBalance(branchId, employeeId);
        if (amount.compareTo(balance) > 0) {
            throw YuzplusException.conflict("shortage.exceedsBalance", balance.format());
        }
        long id = insert(branchId, employeeId, Kind.WRITTEN_OFF, amount, null, null, null, why, actor.employeeId());
        Money next = move(branchId, employeeId, Money.ZERO.minus(amount));
        audit.record(AuditEntry.of("shortage.writtenOff", "employee_shortage", id)
                .change(Map.of("balance", balance.toString()), Map.of("balance", next.toString()))
                .withReason(why));
    }

    @Transactional(readOnly = true)
    Overview overview(Actor actor, Long branchId, Long employeeId, boolean openOnly) {
        if (branchId != null && !actor.canAccessBranch(branchId)) {
            throw YuzplusException.forbidden("auth.forbidden");
        }
        List<Balance> balances = jdbc.sql("""
                SELECT s.employee_id, e.full_name, s.branch_id, b.name AS branch, s.balance,
                       coalesce((SELECT sum(amount) FROM employee_shortage x WHERE x.branch_id = s.branch_id AND x.employee_id = s.employee_id
                                 AND x.kind = 'SHORTAGE'), 0) AS total
                FROM employee_shortage_balance s JOIN employee e ON e.id = s.employee_id JOIN branch b ON b.id = s.branch_id
                WHERE (CAST(:b AS BIGINT) IS NULL OR s.branch_id = :b) AND (CAST(:e AS BIGINT) IS NULL OR s.employee_id = :e)
                  AND (NOT :open OR s.balance > 0)
                ORDER BY s.balance DESC, e.full_name""")
                .param("b", branchId).param("e", employeeId).param("open", openOnly)
                .query((rs, n) -> {
                    if (!actor.canAccessBranch(rs.getLong("branch_id"))) {
                        return null;
                    }
                    BigDecimal bal = rs.getBigDecimal("balance");
                    BigDecimal total = rs.getBigDecimal("total");
                    return new Balance(rs.getLong("employee_id"), rs.getString("full_name"), rs.getLong("branch_id"), rs.getString("branch"),
                            new Money(bal).toString(), new Money(total).toString(), new Money(total.subtract(bal)).toString());
                })
                .list().stream().filter(Objects::nonNull).toList();
        List<Entry> entries = jdbc.sql("""
                SELECT x.id, x.employee_id, e.full_name, x.branch_id, x.kind, x.amount, x.trip_id, t.number AS trip, c.number AS cash_op, x.note,
                       cb.full_name AS created_by, x.created_at
                FROM employee_shortage x JOIN employee e ON e.id = x.employee_id JOIN employee cb ON cb.id = x.created_by
                LEFT JOIN trip t ON t.id = x.trip_id LEFT JOIN cash_op c ON c.id = x.cash_op_id
                WHERE (CAST(:b AS BIGINT) IS NULL OR x.branch_id = :b) AND (CAST(:e AS BIGINT) IS NULL OR x.employee_id = :e)
                ORDER BY x.id DESC LIMIT 300""")
                .param("b", branchId).param("e", employeeId)
                .query((rs, n) -> actor.canAccessBranch(rs.getLong("branch_id"))
                        ? new Entry(rs.getLong("id"), rs.getLong("employee_id"), rs.getString("full_name"), rs.getLong("branch_id"),
                                Kind.valueOf(rs.getString("kind")), new Money(rs.getBigDecimal("amount")).toString(),
                                rs.getObject("trip_id", Long.class), rs.getString("trip"), rs.getString("cash_op"), rs.getString("note"),
                                rs.getString("created_by"), rs.getTimestamp("created_at").toInstant())
                        : null)
                .list().stream().filter(Objects::nonNull).toList();
        return new Overview(balances, entries);
    }

    private Accounts.Account cashAccount(long branchId, long accountId) {
        return accounts.find(accountId)
                .filter(a -> a.branchId() == branchId && a.active() && a.kind() == Accounts.Kind.CASH)
                .orElseThrow(() -> YuzplusException.badRequest("payment.cashAccountRequired"));
    }

    private String employeeName(long employeeId) {
        return jdbc.sql("SELECT full_name FROM employee WHERE id = :e").param("e", employeeId).query(String.class).optional()
                .orElseThrow(() -> YuzplusException.notFound("error.notFound"));
    }

    private long insert(long branchId, long employeeId, Kind kind, Money amount, Long tripId, Long acceptId, Long cashOpId, String note, long by) {
        return jdbc.sql("""
                INSERT INTO employee_shortage (branch_id, employee_id, kind, amount, trip_id, trip_cash_accept_id, cash_op_id, note, created_by)
                VALUES (:b, :e, :k, :a, :t, :ta, :c, :n, :by) RETURNING id""")
                .param("b", branchId).param("e", employeeId).param("k", kind.name()).param("a", amount.amount())
                .param("t", tripId).param("ta", acceptId).param("c", cashOpId).param("n", note).param("by", by)
                .query(Long.class).single();
    }

    /** Qoldiq qatorini qulflaydi (yo'q bo'lsa — 0). */
    private Money lockBalance(long branchId, long employeeId) {
        return jdbc.sql("SELECT balance FROM employee_shortage_balance WHERE branch_id = :b AND employee_id = :e FOR UPDATE")
                .param("b", branchId).param("e", employeeId)
                .query(BigDecimal.class).optional().map(Money::new)
                .orElseThrow(() -> YuzplusException.conflict("shortage.exceedsBalance", Money.ZERO.format()));
    }

    private Money move(long branchId, long employeeId, Money delta) {
        BigDecimal next = jdbc.sql("""
                INSERT INTO employee_shortage_balance (branch_id, employee_id, balance) VALUES (:b, :e, :d)
                ON CONFLICT (branch_id, employee_id) DO UPDATE SET balance = employee_shortage_balance.balance + :d, updated_at = now()
                RETURNING balance""")
                .param("b", branchId).param("e", employeeId).param("d", delta.amount())
                .query(BigDecimal.class).single();
        return new Money(next);
    }
}
