package uz.yuzplus.sales.order;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.sql.Date;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import org.apache.poi.ss.usermodel.BorderStyle;
import org.apache.poi.ss.usermodel.CellStyle;
import org.apache.poi.ss.usermodel.Font;
import org.apache.poi.ss.usermodel.HorizontalAlignment;
import org.apache.poi.ss.usermodel.PrintSetup;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.usermodel.VerticalAlignment;
import org.apache.poi.ss.util.CellRangeAddress;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.json.JsonMapper;
import uz.yuzplus.inventory.StockReservations;
import uz.yuzplus.shared.audit.AuditEntry;
import uz.yuzplus.shared.audit.AuditLog;
import uz.yuzplus.shared.error.YuzplusException;
import uz.yuzplus.shared.security.Actor;

/**
 * O18 (egasi 17.11.2026, shablon `docs/notes/faktura-shablonlar-egasi.xlsx`): 5 xil faktura (Excel) va chiqarishdan oldin qo'lda
 * tuzatish. Asl qatorlar — buyurtma qatorlari × yig'ilgan partiyalar (har partiya alohida qator: seriya, muddat); tuzatishlar faqat
 * faylga ta'sir qiladi va buyurtmaga saqlanadi (5 turda umumiy), «Asl holatiga» — o'chiriladi. Ombor fakturalari Худуд bo'yicha.
 */
@Service
class OrderInvoiceForms {

    /** Faktura turi — ustunlar AYNAN shablondagidek. */
    enum FormType {
        WAREHOUSE("Фактура для склада", true, List.of("№", "Худуд", "Махсулот номи", "Ишлаб чикарувчиси", "Серия", "Сони", "Яроклик муддати",
                "Ул/Бирлиги", "ККС билан Нархи", "ККС билан Жами киймати (Сумма)")),
        WAREHOUSE2("Фактура для склада №2", false, List.of("№", "Худуд", "Махсулот номи", "Ишлаб чикарувчиси", "Серия", "Сони",
                "Яроклик муддати", "Ул/Бирлиги")),
        CLIENT_SEND("Фактура для Клиентов отправка", true, List.of("№", "Фарм ИД", "Махсулот номи", "Ишлаб чикарувчиси", "Серия", "Сони",
                "Яроклик муддати", "Ул/Бирлиги", "ККС билан Нархи", "ККС билан Жами киймати (Сумма)")),
        CLIENT1("Фактура Для клиента №1", true, List.of("№", "Махсулот номи", "Ишлаб чикарувчиси", "Серия", "Сони", "Яроклик муддати",
                "Ул/Бирлиги", "ККС билан Нархи", "ККС билан Жами киймати (Сумма)")),
        CLIENT2("Фактура Для Клиента №2", true, List.of("№", "Махсулот номи", "Ишлаб чикарувчиси", "Сони", "Яроклик муддати", "Ул/Бирлиги",
                "ККС билан Нархи", "ККС билан Жами киймати (Сумма)"));

        final String title;
        final boolean priced;
        final List<String> columns;

        FormType(String title, boolean priced, List<String> columns) {
            this.title = title;
            this.priced = priced;
            this.columns = columns;
        }

        boolean warehouse() {
            return this == WAREHOUSE || this == WAREHOUSE2;
        }

        /** FT1: ustun kalitlari (frontend bilan bir xil) — yashirish shu kalitlar bilan saqlanadi. */
        List<String> keys() {
            return columns.stream().map(COLUMN_KEYS::get).toList();
        }
    }

    /** FT1: ustun sarlavhasi → kalit. */
    static final Map<String, String> COLUMN_KEYS = Map.ofEntries(Map.entry("№", "no"), Map.entry("Худуд", "area"),
            Map.entry("Фарм ИД", "farmId"), Map.entry("Махсулот номи", "name"), Map.entry("Ишлаб чикарувчиси", "manufacturer"),
            Map.entry("Серия", "series"), Map.entry("Сони", "qty"), Map.entry("Яроклик муддати", "expiry"), Map.entry("Ул/Бирлиги", "unit"),
            Map.entry("ККС билан Нархи", "price"), Map.entry("ККС билан Жами киймати (Сумма)", "total"));

    /** FT4: qoʻshilgan ustun — kalit {@code x1…}, nomi erkin. */
    record ExtraColumn(@NotBlank @Pattern(regexp = "x\\d{1,3}") String key, @NotBlank(message = "{validation.required}") @Size(max = 60) String title) {}

    /** FT3/FT5: shablondagi boʻlim — nomi va unga tegishli mahsulot nomlari. */
    record TemplateSection(String title, List<String> products) {}

    /** FT5: mijoz + faktura turi shabloni. */
    record Template(List<String> hidden, List<ExtraColumn> extraColumns, List<TemplateSection> sections) {}

    static final int MAX_EXTRA_COLUMNS = 10;

    record FormRow(
            @Schema(nullable = true, description = "Худуд — buyurtma omboridagi joy (O13)") @Size(max = 60) String area,
            @Schema(nullable = true) @Size(max = 50) String farmId,
            @NotBlank(message = "{validation.required}") @Size(max = 300) String name,
            @Schema(nullable = true) @Size(max = 200) String manufacturer,
            @Schema(nullable = true, description = "Серия (partiya)") @Size(max = 60) String series,
            @Min(0) int qty,
            @Schema(nullable = true, description = "Яроклик муддати — DD.MM.YYYY yoki erkin matn") @Size(max = 20) String expiry,
            @Schema(nullable = true) @Size(max = 20) String unit,
            @Schema(nullable = true, description = "ККС билан Нархи (narx ko'rish ruxsatisiz — null)") @Pattern(regexp = "\\d{1,16}(\\.\\d{1,2})?")
            String price,
            @Schema(nullable = true, description = "ККС билан Жами — qty × price") String total,
            @Schema(nullable = true, description = "O25: seriya manbai — RESERVED (zahira) yoki PROPOSED (FEFO taklifi); yig'ilgan/oddiy — null")
            @Pattern(regexp = "RESERVED|PROPOSED") String batchHint,
            @Schema(nullable = true, description = "O25: qoldiq yetmagan miqdor (shu qator — partiyasiz qolgan qism)") @Min(1) Integer shortage,
            @Schema(nullable = true, description = "FT3: SECTION — boʻlim sarlavhasi (name = boʻlim nomi); null yoki ROW — mahsulot qatori")
            @Pattern(regexp = "ROW|SECTION") String kind,
            @Schema(nullable = true, description = "FT2: fakturadan olib tashlangan (faylga chiqmaydi)") Boolean removed,
            @Schema(nullable = true, description = "FT4: qoʻshilgan ustunlar kataklari — kalit → matn") @Size(max = MAX_EXTRA_COLUMNS)
            Map<String, @Size(max = 200) String> extra) {}

    static boolean isSection(FormRow r) {
        return "SECTION".equals(r.kind());
    }

    static boolean isRemoved(FormRow r) {
        return Boolean.TRUE.equals(r.removed());
    }

    static FormRow sectionRow(String title) {
        return new FormRow(null, null, title, null, null, 0, null, null, null, null, null, null, "SECTION", null, null);
    }

    record InvoiceForms(
            long orderId,
            String orderNumber,
            LocalDate date,
            String customer,
            @Schema(nullable = true) String tin,
            String warehouse,
            @Schema(description = "Joriy qatorlar (tuzatilgan bo'lsa — tuzatilgani)") List<FormRow> rows,
            @Schema(description = "Asl qatorlar (buyurtmadan)") List<FormRow> original,
            boolean edited,
            @Schema(nullable = true) String editedBy,
            @Schema(nullable = true) Instant editedAt,
            boolean canEdit,
            boolean canSeePrices,
            @Schema(description = "O25: buyurtmadan tovar yig'ilganmi (yig'ilmagan bo'lsa — FEFO so'rovi ko'rsatiladi)") boolean picked,
            @Schema(description = "O25: seriya/muddat FEFO bo'yicha to'ldirildimi") boolean fefo,
            @Schema(description = "FT4: qoʻshilgan ustunlar") List<ExtraColumn> extraColumns,
            @Schema(description = "FT1: faktura turi → yashirilgan ustun kalitlari") Map<String, List<String>> hidden,
            @Schema(description = "FT5: shu mijozda shabloni bor faktura turlari") List<String> templates,
            @Schema(description = "FT5: tuzatilmagan faktura shablon boʻyicha koʻrsatildi") boolean templateApplied) {}

    record InvoiceFormSave(
            @NotNull @Size(max = 1000) List<@Valid FormRow> rows,
            @Schema(nullable = true) @Size(max = MAX_EXTRA_COLUMNS) List<@Valid ExtraColumn> extraColumns,
            @Schema(nullable = true, description = "Faktura turi → yashirilgan ustun kalitlari") Map<String, List<String>> hidden) {}

    private record Head(long id, String number, LocalDate date, String customer, String tin, String warehouse, long warehouseId, long branchId,
            long customerId, String status) {}

    /** O25: zahira olinmagan holatlar — FEFO faqat taklif (hech narsa yozilmaydi). */
    private static final java.util.Set<String> PROPOSAL_STATUSES = java.util.Set.of("DRAFT", "PENDING_APPROVAL");
    /** O25: bekor qilingan buyurtmada zahira yo'q — oddiy faktura. */
    private static final java.util.Set<String> NO_FEFO_STATUSES = java.util.Set.of("CANCELLED", "REJECTED");

    private static final DateTimeFormatter DMY = DateTimeFormatter.ofPattern("dd.MM.yyyy");
    private static final ZoneId TASHKENT = ZoneId.of("Asia/Tashkent");

    private final JdbcClient jdbc;
    private final AuditLog audit;
    private final StockReservations reservations;
    private final java.time.Clock clock;
    private final JsonMapper json;

    OrderInvoiceForms(JdbcClient jdbc, AuditLog audit, StockReservations reservations, java.time.Clock clock, JsonMapper json) {
        this.jdbc = jdbc;
        this.audit = audit;
        this.reservations = reservations;
        this.clock = clock;
        this.json = json;
    }

    private <T> T read(String s, TypeReference<T> type, T empty) {
        return s == null || s.isBlank() ? empty : json.readValue(s, type);
    }

    private static final TypeReference<Map<String, String>> EXTRA = new TypeReference<>() {};
    private static final TypeReference<List<ExtraColumn>> EXTRA_COLUMNS = new TypeReference<>() {};
    private static final TypeReference<Map<String, List<String>>> HIDDEN = new TypeReference<>() {};
    private static final TypeReference<List<String>> STRINGS = new TypeReference<>() {};
    private static final TypeReference<List<TemplateSection>> SECTIONS = new TypeReference<>() {};

    private Head head(Actor actor, long id) {
        return jdbc.sql("""
                SELECT o.id, o.number, o.created_at, coalesce(nullif(btrim(c.legal_name), ''), c.name) AS customer, c.tin, w.name AS warehouse,
                       o.warehouse_id, o.branch_id, o.customer_id, o.status
                FROM sales_order o JOIN counterparty c ON c.id = o.customer_id JOIN warehouse w ON w.id = o.warehouse_id WHERE o.id = :id""")
                .param("id", id)
                .query((rs, n) -> new Head(rs.getLong("id"), rs.getString("number"),
                        rs.getTimestamp("created_at").toInstant().atZone(TASHKENT).toLocalDate(), rs.getString("customer"), rs.getString("tin"),
                        rs.getString("warehouse"), rs.getLong("warehouse_id"), rs.getLong("branch_id"), rs.getLong("customer_id"),
                        rs.getString("status")))
                .optional()
                .filter(h -> actor.canAccessBranch(h.branchId()))
                .orElseThrow(() -> YuzplusException.notFound("error.notFound"));
    }

    /** Asl qatorlar: har buyurtma qatori × sof yig'ilgan partiya; yig'ilmagan qator — partiyasiz bitta qator. */
    List<FormRow> original(long orderId, long warehouseId) {
        record Raw(long lineId, int lineNo, String area, String farmId, String name, String manufacturer, String unit, int lineQty, BigDecimal price,
                String series, Date expiry, Integer pickedQty) {}
        List<Raw> raw = jdbc.sql("""
                SELECT l.id, l.line_no, pl.location AS area, p.farm_id, p.name, m.name AS manufacturer, coalesce(u.short_name, u.name) AS unit, l.qty,
                       l.price, b.number AS series, b.expiry_date, t.qty AS picked
                FROM sales_order_line l
                JOIN product p ON p.id = l.product_id
                LEFT JOIN manufacturer m ON m.id = p.manufacturer_id
                LEFT JOIN unit u ON u.id = p.unit_id
                LEFT JOIN product_location pl ON pl.product_id = p.id AND pl.warehouse_id = :w
                LEFT JOIN LATERAL (
                    SELECT x.batch_id, sum(x.qty)::int AS qty FROM (
                        SELECT batch_id, qty FROM sales_order_pick WHERE order_id = l.order_id AND line_id = l.id
                        UNION ALL
                        SELECT r.batch_id, -r.qty FROM sales_order_pick_return r WHERE r.order_id = l.order_id
                          AND r.batch_id IN (SELECT batch_id FROM sales_order_pick WHERE order_id = l.order_id AND line_id = l.id)) x
                    GROUP BY x.batch_id HAVING sum(x.qty) > 0) t ON true
                LEFT JOIN batch b ON b.id = t.batch_id
                WHERE l.order_id = :o
                ORDER BY l.line_no, b.expiry_date NULLS LAST, b.id""")
                .param("o", orderId)
                .param("w", warehouseId)
                .query((rs, n) -> new Raw(rs.getLong("id"), rs.getInt("line_no"), rs.getString("area"), rs.getString("farm_id"), rs.getString("name"),
                        rs.getString("manufacturer"), rs.getString("unit"), rs.getInt("qty"), rs.getBigDecimal("price"), rs.getString("series"),
                        rs.getDate("expiry_date"), (Integer) rs.getObject("picked")))
                .list();
        List<FormRow> out = new ArrayList<>();
        for (Raw r : raw) {
            int qty = r.pickedQty() == null ? r.lineQty() : r.pickedQty();
            BigDecimal price = r.price() == null ? BigDecimal.ZERO : r.price();
            out.add(row(r.area(), r.farmId(), r.name(), r.manufacturer(), r.series(), qty,
                    r.expiry() == null ? null : DMY.format(r.expiry().toLocalDate()), r.unit(), price));
        }
        return out;
    }

    /**
     * O25: yig'ilmagan buyurtma — har qator partiyalarga bo'linadi. «Navbatda» va undan keyin — faol zahira (RESERVED); undan oldin — FEFO
     * taklifi (PROPOSED, {@link StockReservations#plan} — sotuvga ochiq zona, mijozning minimal muddat talabi; hech narsa yozilmaydi).
     * Yetmagan qism — partiyasiz qator {@code shortage} bilan.
     */
    private List<FormRow> fefoRows(Head h) {
        record Line(long id, long productId, String area, String farmId, String name, String manufacturer, String unit, int qty, BigDecimal price) {}
        List<Line> lines = jdbc.sql("""
                SELECT l.id, l.product_id, pl.location AS area, p.farm_id, p.name, m.name AS manufacturer, coalesce(u.short_name, u.name) AS unit,
                       l.qty, l.price
                FROM sales_order_line l
                JOIN product p ON p.id = l.product_id
                LEFT JOIN manufacturer m ON m.id = p.manufacturer_id
                LEFT JOIN unit u ON u.id = p.unit_id
                LEFT JOIN product_location pl ON pl.product_id = p.id AND pl.warehouse_id = :w
                WHERE l.order_id = :o
                ORDER BY l.line_no""")
                .param("o", h.id())
                .param("w", h.warehouseId())
                .query((rs, n) -> new Line(rs.getLong("id"), rs.getLong("product_id"), rs.getString("area"), rs.getString("farm_id"),
                        rs.getString("name"), rs.getString("manufacturer"), rs.getString("unit"), rs.getInt("qty"), rs.getBigDecimal("price")))
                .list();
        record Part(long batchId, int qty) {}
        Map<Long, List<Part>> byLine = new java.util.HashMap<>();
        boolean proposal = PROPOSAL_STATUSES.contains(h.status());
        if (proposal) {
            Integer days = jdbc.sql("SELECT min_shelf_life_days FROM counterparty_branch_terms WHERE counterparty_id = :c AND branch_id = :b")
                    .param("c", h.customerId())
                    .param("b", h.branchId())
                    .query(Integer.class)
                    .optional()
                    .orElse(null);
            LocalDate minExpiry = LocalDate.now(clock.withZone(TASHKENT)).plusDays(days == null ? 0 : days);
            Map<Long, Integer> need = new java.util.LinkedHashMap<>();
            lines.forEach(l -> need.merge(l.productId(), l.qty(), Integer::sum));
            Map<Long, java.util.ArrayDeque<long[]>> pool = new java.util.HashMap<>();
            reservations.plan(h.warehouseId(), minExpiry, need).forEach((product, planned) -> pool.put(product,
                    planned.stream().map(x -> new long[] {x.batchId(), x.qty()}).collect(java.util.stream.Collectors.toCollection(java.util.ArrayDeque::new))));
            for (Line l : lines) {
                java.util.ArrayDeque<long[]> q = pool.getOrDefault(l.productId(), new java.util.ArrayDeque<>());
                int left = l.qty();
                while (left > 0 && !q.isEmpty()) {
                    long[] head = q.peekFirst();
                    int take = (int) Math.min(left, head[1]);
                    byLine.computeIfAbsent(l.id(), k -> new ArrayList<>()).add(new Part(head[0], take));
                    head[1] -= take;
                    left -= take;
                    if (head[1] == 0) {
                        q.pollFirst();
                    }
                }
            }
        } else {
            for (StockReservations.Allocation a : reservations.active(Orders.DOC_TYPE, h.id())) {
                List<Part> parts = byLine.computeIfAbsent(a.lineId(), k -> new ArrayList<>());
                // bir partiya bir necha zonada zahiralangan bo'lsa — bitta qator
                if (!parts.isEmpty() && parts.getLast().batchId() == a.batchId()) {
                    parts.set(parts.size() - 1, new Part(a.batchId(), parts.getLast().qty() + a.qty()));
                } else {
                    parts.add(new Part(a.batchId(), a.qty()));
                }
            }
        }
        record Batch(String number, LocalDate expiry) {}
        java.util.Set<Long> batchIds = new java.util.HashSet<>();
        byLine.values().forEach(ps -> ps.forEach(x -> batchIds.add(x.batchId())));
        Map<Long, Batch> batches = new java.util.HashMap<>();
        if (!batchIds.isEmpty()) {
            jdbc.sql("SELECT id, number, expiry_date FROM batch WHERE id IN (:ids)")
                    .param("ids", batchIds)
                    .query((rs, n) -> Map.entry(rs.getLong("id"), new Batch(rs.getString("number"), rs.getObject("expiry_date", LocalDate.class))))
                    .list()
                    .forEach(e -> batches.put(e.getKey(), e.getValue()));
        }
        String hint = proposal ? "PROPOSED" : "RESERVED";
        List<FormRow> out = new ArrayList<>();
        for (Line l : lines) {
            BigDecimal price = l.price() == null ? BigDecimal.ZERO : l.price();
            int covered = 0;
            for (Part x : byLine.getOrDefault(l.id(), List.of())) {
                Batch b = batches.get(x.batchId());
                FormRow r = row(l.area(), l.farmId(), l.name(), l.manufacturer(), b.number(), x.qty(), b.expiry() == null ? null : DMY.format(b.expiry()),
                        l.unit(), price);
                out.add(withHint(r, hint, null));
                covered += x.qty();
            }
            if (covered < l.qty()) {
                int missing = l.qty() - covered;
                out.add(withHint(row(l.area(), l.farmId(), l.name(), l.manufacturer(), null, missing, null, l.unit(), price), null, missing));
            }
        }
        return out;
    }

    private static FormRow withHint(FormRow r, String hint, Integer shortage) {
        return new FormRow(r.area(), r.farmId(), r.name(), r.manufacturer(), r.series(), r.qty(), r.expiry(), r.unit(), r.price(), r.total(), hint, shortage,
                r.kind(), r.removed(), r.extra());
    }

    /** O25: chop etishdagi «Серия» katagi — zahira/taklif belgisi yoki «Етишмайди: N». */
    static String printSeries(FormRow r) {
        if (r.shortage() != null) {
            return "Етишмайди: " + r.shortage();
        }
        if (r.series() == null || r.batchHint() == null) {
            return r.series();
        }
        return r.series() + ("RESERVED".equals(r.batchHint()) ? " (захира)" : " (таклиф)");
    }

    static final String FEFO_NOTE = "Серия ва муддат — тизим таклифи (FEFO). Йиғувчи бошқа партиядан олса, панелда «Бошқа партиядан олдим» ни танлайди.";

    private static FormRow row(String area, String farmId, String name, String manufacturer, String series, int qty, String expiry, String unit,
            BigDecimal price) {
        BigDecimal p = price.setScale(2, RoundingMode.HALF_UP);
        return new FormRow(area, farmId, name, manufacturer, series, qty, expiry, unit, p.toPlainString(),
                p.multiply(BigDecimal.valueOf(qty)).setScale(2, RoundingMode.HALF_UP).toPlainString(), null, null, null, null, null);
    }

    private static FormRow hidePrice(FormRow r) {
        return new FormRow(r.area(), r.farmId(), r.name(), r.manufacturer(), r.series(), r.qty(), r.expiry(), r.unit(), null, null, r.batchHint(),
                r.shortage(), r.kind(), r.removed(), r.extra());
    }

    private static FormRow withFlags(FormRow r, String kind, boolean removed, Map<String, String> extra) {
        return new FormRow(r.area(), r.farmId(), r.name(), r.manufacturer(), r.series(), r.qty(), r.expiry(), r.unit(), r.price(), r.total(),
                r.batchHint(), r.shortage(), "SECTION".equals(kind) ? "SECTION" : null, removed ? Boolean.TRUE : null,
                extra == null || extra.isEmpty() ? null : extra);
    }

    /**
     * FT5: shablonni qatorlarga qoʻllaydi — boʻlimlar shablondagi tartibda, mahsulot nomi boʻyicha (katta-kichik harf farqsiz) oʻz boʻlimiga;
     * shablonda yoʻq mahsulotlar — eng tepada (boʻlimsiz). Boʻsh boʻlim qoʻshilmaydi. Qoʻshilgan ustunlar nomi boʻyicha birlashadi.
     */
    record Applied(List<FormRow> rows, List<ExtraColumn> extraColumns) {}

    static Applied applyTemplate(List<FormRow> rows, List<ExtraColumn> extras, Template t) {
        List<ExtraColumn> ex = new ArrayList<>(extras);
        for (ExtraColumn c : t.extraColumns()) {
            if (ex.size() < MAX_EXTRA_COLUMNS && ex.stream().noneMatch(e -> e.title().strip().equalsIgnoreCase(c.title().strip()))) {
                ex.add(new ExtraColumn(nextExtraKey(ex), c.title().strip()));
            }
        }
        Map<String, Integer> sectionOf = new java.util.HashMap<>();
        for (int i = 0; i < t.sections().size(); i++) {
            for (String p : t.sections().get(i).products()) {
                sectionOf.putIfAbsent(p.strip().toLowerCase(java.util.Locale.ROOT), i);
            }
        }
        List<FormRow> items = rows.stream().filter(r -> !isSection(r)).toList();
        List<FormRow> out = new ArrayList<>();
        for (FormRow r : items) {
            if (!sectionOf.containsKey(r.name().strip().toLowerCase(java.util.Locale.ROOT))) {
                out.add(r);
            }
        }
        for (int i = 0; i < t.sections().size(); i++) {
            final int k = i;
            List<FormRow> mine = items.stream().filter(r -> Integer.valueOf(k).equals(sectionOf.get(r.name().strip().toLowerCase(java.util.Locale.ROOT))))
                    .toList();
            if (!mine.isEmpty()) {
                out.add(sectionRow(t.sections().get(i).title()));
                out.addAll(mine);
            }
        }
        return new Applied(out, ex);
    }

    static String nextExtraKey(List<ExtraColumn> ex) {
        int max = ex.stream().mapToInt(e -> Integer.parseInt(e.key().substring(1))).max().orElse(0);
        return "x" + (max + 1);
    }

    /** FT5: joriy koʻrinishdan shablon — tanlangan turning yashirin ustunlari, qoʻshilgan ustunlar, boʻlimlar va ulardagi mahsulotlar. */
    static Template templateOf(InvoiceForms f, FormType type) {
        List<TemplateSection> sections = new ArrayList<>();
        String title = null;
        List<String> products = null;
        for (FormRow r : f.rows()) {
            if (isSection(r)) {
                if (title != null) {
                    sections.add(new TemplateSection(title, products));
                }
                title = r.name().strip();
                products = new ArrayList<>();
            } else if (products != null && !products.contains(r.name().strip())) {
                products.add(r.name().strip());
            }
        }
        if (title != null) {
            sections.add(new TemplateSection(title, products));
        }
        return new Template(f.hidden().getOrDefault(type.name(), List.of()), f.extraColumns(), sections);
    }

    private List<FormRow> saved(long orderId) {
        return jdbc.sql("""
                SELECT area, farm_id, name, manufacturer, series, qty, expiry, unit, price, kind, removed, extra::text AS extra
                FROM order_invoice_edit_row WHERE order_id = :o ORDER BY pos""")
                .param("o", orderId)
                .query((rs, n) -> {
                    boolean section = "SECTION".equals(rs.getString("kind"));
                    FormRow base = section ? sectionRow(rs.getString("name"))
                            : row(rs.getString("area"), rs.getString("farm_id"), rs.getString("name"), rs.getString("manufacturer"),
                                    rs.getString("series"), rs.getInt("qty"), rs.getString("expiry"), rs.getString("unit"), rs.getBigDecimal("price"));
                    return withFlags(base, rs.getString("kind"), rs.getBoolean("removed"), read(rs.getString("extra"), EXTRA, Map.of()));
                })
                .list();
    }

    /** FT5: mijozning barcha shablonlari (faktura turi → shablon). */
    private Map<String, Template> templates(long customerId) {
        record Entry(String type, Template template) {}
        Map<String, Template> out = new java.util.LinkedHashMap<>();
        jdbc.sql("""
                SELECT form_type, hidden::text AS hidden, extra_columns::text AS extra_columns, sections::text AS sections
                FROM invoice_form_template WHERE customer_id = :c ORDER BY form_type""")
                .param("c", customerId)
                .query((rs, n) -> new Entry(rs.getString("form_type"), new Template(read(rs.getString("hidden"), STRINGS, List.of()),
                        read(rs.getString("extra_columns"), EXTRA_COLUMNS, List.of()), read(rs.getString("sections"), SECTIONS, List.of()))))
                .list()
                .forEach(e -> out.put(e.type(), e.template()));
        return out;
    }

    @Transactional(readOnly = true)
    InvoiceForms get(Actor actor, long id, boolean prices, boolean canEdit, FormType type) {
        return get(actor, id, prices, canEdit, false, type);
    }

    /**
     * {@code fefo} — O25: yig'ilmagan buyurtmada seriya/muddat zahira yoki FEFO taklifidan. {@code type} — FT5: tuzatilmagan fakturada shu
     * turning shabloni (mijoz bo'yicha) qo'llanadi; null — shablonsiz.
     */
    @Transactional(readOnly = true)
    InvoiceForms get(Actor actor, long id, boolean prices, boolean canEdit, boolean fefo, FormType type) {
        Head h = head(actor, id);
        boolean picked = jdbc.sql("SELECT EXISTS (SELECT 1 FROM sales_order_pick WHERE order_id = :o)").param("o", id).query(Boolean.class).single();
        boolean useFefo = fefo && !picked && !NO_FEFO_STATUSES.contains(h.status());
        List<FormRow> original = useFefo ? fefoRows(h) : original(id, h.warehouseId());
        record Meta(String by, Instant at, List<ExtraColumn> extra, Map<String, List<String>> hidden) {}
        Meta meta = jdbc.sql("""
                SELECT e.full_name, x.updated_at, x.extra_columns::text AS extra_columns, x.hidden::text AS hidden
                FROM order_invoice_edit x JOIN employee e ON e.id = x.updated_by WHERE x.order_id = :o""")
                .param("o", id)
                .query((rs, n) -> new Meta(rs.getString("full_name"), rs.getTimestamp("updated_at").toInstant(),
                        read(rs.getString("extra_columns"), EXTRA_COLUMNS, List.of()), read(rs.getString("hidden"), HIDDEN, Map.of())))
                .optional()
                .orElse(null);
        Map<String, Template> templates = templates(h.customerId());
        List<FormRow> rows;
        List<ExtraColumn> extras;
        Map<String, List<String>> hidden;
        boolean templateApplied = false;
        if (meta != null) {
            rows = saved(id);
            extras = meta.extra();
            hidden = meta.hidden();
        } else {
            rows = original;
            extras = List.of();
            Map<String, List<String>> fromTemplates = new java.util.TreeMap<>();
            templates.forEach((k, v) -> {
                if (!v.hidden().isEmpty()) {
                    fromTemplates.put(k, v.hidden());
                }
            });
            hidden = fromTemplates;
            Template t = type == null ? null : templates.get(type.name());
            if (t != null) {
                Applied a = applyTemplate(rows, extras, t);
                rows = a.rows();
                extras = a.extraColumns();
                templateApplied = true;
            }
        }
        if (!prices) {
            rows = rows.stream().map(OrderInvoiceForms::hidePrice).toList();
            original = original.stream().map(OrderInvoiceForms::hidePrice).toList();
        }
        return new InvoiceForms(h.id(), h.number(), h.date(), h.customer(), h.tin(), h.warehouse(), rows, original, meta != null,
                meta == null ? null : meta.by(), meta == null ? null : meta.at(), canEdit, prices, picked, useFefo && meta == null, extras, hidden,
                List.copyOf(templates.keySet()), templateApplied);
    }

    /** Tuzatilgan holatni saqlaydi (avtosaqlash): faqat fayl uchun — buyurtma, qoldiq, qarz o'zgarmaydi. Audit — nechta qator o'zgardi. */
    @Transactional
    InvoiceForms save(Actor actor, long id, InvoiceFormSave body, boolean prices, FormType type) {
        Head h = head(actor, id);
        jdbc.sql("SELECT id FROM sales_order WHERE id = :id FOR UPDATE").param("id", id).query(Long.class).single();
        List<FormRow> before = jdbc.sql("SELECT 1 FROM order_invoice_edit WHERE order_id = :o").param("o", id).query(Integer.class).optional()
                .isPresent() ? saved(id) : original(id, h.warehouseId());
        List<FormRow> rows = body.rows();
        List<ExtraColumn> extras = cleanExtras(body.extraColumns());
        Map<String, List<String>> hidden = cleanHidden(body.hidden(), extras);
        java.util.Set<String> extraKeys = extras.stream().map(ExtraColumn::key).collect(java.util.stream.Collectors.toSet());
        jdbc.sql("DELETE FROM order_invoice_edit_row WHERE order_id = :o").param("o", id).update();
        jdbc.sql("""
                INSERT INTO order_invoice_edit (order_id, updated_by, extra_columns, hidden) VALUES (:o, :by, CAST(:ex AS jsonb), CAST(:hid AS jsonb))
                ON CONFLICT (order_id) DO UPDATE SET updated_by = :by, updated_at = now(), extra_columns = CAST(:ex AS jsonb),
                    hidden = CAST(:hid AS jsonb)""")
                .param("o", id).param("by", actor.employeeId()).param("ex", json.writeValueAsString(extras))
                .param("hid", json.writeValueAsString(hidden)).update();
        int pos = 0;
        for (FormRow r : rows) {
            boolean section = isSection(r);
            Map<String, String> extra = new java.util.TreeMap<>();
            if (r.extra() != null && !section) {
                r.extra().forEach((k, v) -> {
                    if (extraKeys.contains(k) && v != null && !v.isBlank()) {
                        extra.put(k, v.strip());
                    }
                });
            }
            jdbc.sql("""
                    INSERT INTO order_invoice_edit_row (order_id, pos, area, farm_id, name, manufacturer, series, qty, expiry, unit, price, kind, removed,
                                                        extra)
                    VALUES (:o, :p, :area, :farm, :name, :man, :ser, :qty, :exp, :unit, :price, :kind, :removed, CAST(:extra AS jsonb))""")
                    .param("o", id)
                    .param("p", ++pos)
                    .param("kind", section ? "SECTION" : "ROW")
                    .param("removed", !section && isRemoved(r))
                    .param("extra", extra.isEmpty() ? null : json.writeValueAsString(extra))
                    .param("area", blank(r.area()))
                    .param("farm", blank(r.farmId()))
                    .param("name", r.name().strip())
                    .param("man", blank(r.manufacturer()))
                    .param("ser", blank(r.series()))
                    .param("qty", r.qty())
                    .param("exp", blank(r.expiry()))
                    .param("unit", blank(r.unit()))
                    .param("price", r.price() == null || section ? BigDecimal.ZERO : new BigDecimal(r.price()))
                    .update();
        }
        int changed = 0;
        for (int i = 0; i < Math.max(before.size(), rows.size()); i++) {
            FormRow a = i < before.size() ? before.get(i) : null;
            FormRow b = i < rows.size() ? rows.get(i) : null;
            if (a == null || b == null || !same(a, b)) {
                changed++;
            }
        }
        audit.record(AuditEntry.of("order.invoiceEdit", "sales_order", id)
                .change(Map.of("rows", before.size()), Map.of("rows", rows.size(), "changedRows", changed,
                        "removedRows", rows.stream().filter(r -> !isSection(r) && isRemoved(r)).count(),
                        "sections", rows.stream().filter(OrderInvoiceForms::isSection).count(), "extraColumns", extras.size(),
                        "hiddenColumns", hidden.values().stream().mapToInt(List::size).sum())), actor);
        return get(actor, id, prices, true, type);
    }

    private static List<ExtraColumn> cleanExtras(List<ExtraColumn> in) {
        List<ExtraColumn> out = new ArrayList<>();
        if (in != null) {
            for (ExtraColumn c : in) {
                if (out.stream().noneMatch(x -> x.key().equals(c.key())) && out.size() < MAX_EXTRA_COLUMNS) {
                    out.add(new ExtraColumn(c.key(), c.title().strip()));
                }
            }
        }
        return out;
    }

    /** FT1: faqat maʼlum turlar va shu turdagi ustunlar (+ qoʻshilganlar); «Махсулот номи» yashirilmaydi. */
    private static Map<String, List<String>> cleanHidden(Map<String, List<String>> in, List<ExtraColumn> extras) {
        Map<String, List<String>> out = new java.util.TreeMap<>();
        if (in == null) {
            return out;
        }
        for (FormType t : FormType.values()) {
            List<String> keys = in.get(t.name());
            if (keys == null) {
                continue;
            }
            List<String> ok = keys.stream().distinct()
                    .filter(k -> !"name".equals(k) && (t.keys().contains(k) || extras.stream().anyMatch(e -> e.key().equals(k)))).toList();
            if (!ok.isEmpty()) {
                out.put(t.name(), ok);
            }
        }
        return out;
    }

    /** FT5: joriy koʻrinishni mijoz + faktura turi shabloni sifatida saqlaydi. */
    @Transactional
    InvoiceForms saveTemplate(Actor actor, long id, FormType type, boolean prices) {
        Head h = head(actor, id);
        Template t = templateOf(get(actor, id, prices, true, type), type);
        jdbc.sql("""
                INSERT INTO invoice_form_template (customer_id, form_type, hidden, extra_columns, sections, updated_by)
                VALUES (:c, :t, CAST(:hid AS jsonb), CAST(:ex AS jsonb), CAST(:sec AS jsonb), :by)
                ON CONFLICT (customer_id, form_type) DO UPDATE SET hidden = EXCLUDED.hidden, extra_columns = EXCLUDED.extra_columns,
                    sections = EXCLUDED.sections, updated_by = EXCLUDED.updated_by, updated_at = now()""")
                .param("c", h.customerId()).param("t", type.name()).param("hid", json.writeValueAsString(t.hidden()))
                .param("ex", json.writeValueAsString(t.extraColumns())).param("sec", json.writeValueAsString(t.sections()))
                .param("by", actor.employeeId()).update();
        audit.record(AuditEntry.of("order.invoiceTemplateSave", "sales_order", id)
                .change(Map.of(), Map.of("customerId", h.customerId(), "type", type.name(), "sections", t.sections().size(),
                        "hiddenColumns", t.hidden().size(), "extraColumns", t.extraColumns().size())), actor);
        return get(actor, id, prices, true, type);
    }

    /** FT5: mijozning shu turdagi shablonini oʻchiradi. */
    @Transactional
    InvoiceForms deleteTemplate(Actor actor, long id, FormType type, boolean prices) {
        Head h = head(actor, id);
        int n = jdbc.sql("DELETE FROM invoice_form_template WHERE customer_id = :c AND form_type = :t").param("c", h.customerId())
                .param("t", type.name()).update();
        if (n > 0) {
            audit.record(AuditEntry.of("order.invoiceTemplateDelete", "sales_order", id)
                    .change(Map.of("customerId", h.customerId(), "type", type.name()), Map.of()), actor);
        }
        return get(actor, id, prices, true, type);
    }

    /** FT5 «Shablonni tiklash»: shablonni joriy (tuzatilgan) qatorlarga qoʻllaydi — kataklardagi tuzatishlar saqlanadi. */
    @Transactional
    InvoiceForms restoreTemplate(Actor actor, long id, FormType type, boolean prices) {
        Head h = head(actor, id);
        Template t = templates(h.customerId()).get(type.name());
        if (t == null) {
            throw YuzplusException.notFound("invoiceForms.noTemplate");
        }
        InvoiceForms f = get(actor, id, prices, true, type);
        Applied a = applyTemplate(f.rows(), f.extraColumns(), t);
        Map<String, List<String>> hidden = new java.util.TreeMap<>(f.hidden());
        hidden.put(type.name(), t.hidden());
        return save(actor, id, new InvoiceFormSave(a.rows(), a.extraColumns(), hidden), prices, type);
    }

    /** «Asl holatiga qaytarish» — saqlangan tuzatishlar o'chiriladi. */
    @Transactional
    InvoiceForms revert(Actor actor, long id, boolean prices, FormType type) {
        head(actor, id);
        int n = jdbc.sql("DELETE FROM order_invoice_edit WHERE order_id = :o").param("o", id).update();
        if (n > 0) {
            audit.record(AuditEntry.of("order.invoiceRevert", "sales_order", id).change(Map.of("edited", true), Map.of("edited", false)), actor);
        }
        return get(actor, id, prices, true, type);
    }

    private static boolean same(FormRow a, FormRow b) {
        return java.util.Objects.equals(blank(a.area()), blank(b.area())) && java.util.Objects.equals(blank(a.farmId()), blank(b.farmId()))
                && a.name().strip().equals(b.name().strip()) && java.util.Objects.equals(blank(a.manufacturer()), blank(b.manufacturer()))
                && java.util.Objects.equals(blank(a.series()), blank(b.series())) && a.qty() == b.qty()
                && java.util.Objects.equals(blank(a.expiry()), blank(b.expiry())) && java.util.Objects.equals(blank(a.unit()), blank(b.unit()))
                && (a.price() == null || b.price() == null || new BigDecimal(a.price()).compareTo(new BigDecimal(b.price())) == 0)
                && isSection(a) == isSection(b) && isRemoved(a) == isRemoved(b)
                && java.util.Objects.equals(a.extra() == null ? Map.of() : a.extra(), b.extra() == null ? Map.of() : b.extra());
    }

    private static String blank(String s) {
        return s == null || s.isBlank() ? null : s.strip();
    }

    /** Excel: sarlavha bloki, ustunlar shablondagidek, «Жами» (soni va summa); albom, sahifaga sig'adi, sarlavha har sahifada. */
    @Transactional(readOnly = true)
    byte[] xlsx(Actor actor, long id, FormType type, boolean prices, boolean fefo) {
        return xlsxMany(actor, List.of(id), type, prices, fefo);
    }

    static final int MAX_BULK = 50;

    /** Ommaviy (reys / ro'yxat): bitta fayl, har buyurtma — alohida varaq (varaq nomi = buyurtma raqami). */
    @Transactional(readOnly = true)
    byte[] xlsxMany(Actor actor, List<Long> ids, FormType type, boolean prices, boolean fefo) {
        if (type.priced && !prices) {
            throw YuzplusException.forbidden("invoiceForms.noPrices");
        }
        List<Long> unique = ids == null ? List.of() : ids.stream().distinct().toList();
        if (unique.isEmpty() || unique.size() > MAX_BULK) {
            throw YuzplusException.badRequest("order.invoiceBulkSize", MAX_BULK);
        }
        try (XSSFWorkbook wb = new XSSFWorkbook(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            java.util.Set<String> names = new java.util.HashSet<>();
            for (Long id : unique) {
                InvoiceForms f = get(actor, id, prices, false, fefo && type.warehouse(), type);
                String name = unique.size() == 1 ? type.title.replace("№", "N") : f.orderNumber().replaceAll("[\\\\/?*\\[\\]:]", "-");
                if (name.length() > 31) {
                    name = name.substring(name.length() - 31);
                }
                String base = name;
                for (int k = 2; !names.add(name.toLowerCase(java.util.Locale.ROOT)); k++) {
                    name = (base.length() > 27 ? base.substring(0, 27) : base) + " (" + k + ")";
                }
                sheet(wb, wb.createSheet(name), f, type);
            }
            wb.write(out);
            return out.toByteArray();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    /** Chiqariladigan qatorlar: olib tashlanganlarsiz (FT2); ombor turlari tuzatilmagan va boʻlimsiz bo'lsa Худуд bo'yicha. */
    static List<FormRow> printRows(InvoiceForms f, FormType type) {
        List<FormRow> rows = new ArrayList<>(f.rows().stream().filter(r -> !isRemoved(r)).toList());
        if (type.warehouse() && !f.edited() && rows.stream().noneMatch(OrderInvoiceForms::isSection)) {
            rows.sort(Comparator.comparing((FormRow r) -> r.area() == null ? "￿" : r.area().toLowerCase(java.util.Locale.ROOT)));
        }
        return rows;
    }

    /** FT1/FT4: faylga chiqadigan ustun — kalit va sarlavha (yashirilganlarsiz, qoʻshilganlar oxirida). */
    record PrintColumn(String key, String title) {}

    static List<PrintColumn> printColumns(InvoiceForms f, FormType type) {
        List<String> hidden = f.hidden() == null ? List.of() : f.hidden().getOrDefault(type.name(), List.of());
        List<PrintColumn> out = new ArrayList<>();
        for (String title : type.columns) {
            String key = COLUMN_KEYS.get(title);
            if (!hidden.contains(key)) {
                out.add(new PrintColumn(key, title));
            }
        }
        for (ExtraColumn c : f.extraColumns() == null ? List.<ExtraColumn>of() : f.extraColumns()) {
            if (!hidden.contains(c.key())) {
                out.add(new PrintColumn(c.key(), c.title()));
            }
        }
        return out;
    }

    /** FT3: chop etish qatori — ROW (mahsulot, {@code no} — tartib raqami), SECTION (boʻlim nomi), SUBTOTAL («Бўлим жами»). */
    record PrintLine(String kind, FormRow row, int no, String title, long qty, BigDecimal sum) {}

    record PrintBody(List<PrintLine> lines, long qty, BigDecimal sum) {}

    /** Olib tashlangan qatorlarsiz; boʻsh boʻlim chiqmaydi; jami — faqat chiqadigan qatorlardan. */
    static PrintBody printBody(InvoiceForms f, FormType type) {
        List<PrintLine> out = new ArrayList<>();
        long qty = 0;
        BigDecimal sum = BigDecimal.ZERO;
        int n = 0;
        String section = null;
        List<PrintLine> buf = new ArrayList<>();
        long sQty = 0;
        BigDecimal sSum = BigDecimal.ZERO;
        List<FormRow> rows = new ArrayList<>(printRows(f, type));
        rows.add(sectionRow(""));
        for (FormRow r : rows) {
            if (isSection(r)) {
                if (section != null && !buf.isEmpty()) {
                    out.add(new PrintLine("SECTION", null, 0, section, 0, BigDecimal.ZERO));
                    out.addAll(buf);
                    out.add(new PrintLine("SUBTOTAL", null, 0, "Бўлим жами", sQty, sSum));
                } else {
                    out.addAll(buf);
                }
                buf.clear();
                section = r.name();
                sQty = 0;
                sSum = BigDecimal.ZERO;
                continue;
            }
            BigDecimal total = r.total() == null ? BigDecimal.ZERO : new BigDecimal(r.total());
            buf.add(new PrintLine("ROW", r, ++n, null, r.qty(), total));
            sQty += r.qty();
            sSum = sSum.add(total);
            qty += r.qty();
            sum = sum.add(total);
        }
        return new PrintBody(out, qty, sum);
    }

    /** Katakdagi matn (Excel/PDF uchun umumiy; pul va son — chaqiruvchi formatlaydi). */
    static String cellText(FormRow x, String key) {
        return switch (key) {
            case "area" -> x.area();
            case "farmId" -> x.farmId();
            case "name" -> x.name();
            case "manufacturer" -> x.manufacturer();
            case "series" -> printSeries(x);
            case "expiry" -> x.expiry();
            case "unit" -> x.unit();
            default -> x.extra() == null ? null : x.extra().get(key);
        };
    }

    private static void sheet(XSSFWorkbook wb, Sheet s, InvoiceForms f, FormType type) {
        PrintBody body = printBody(f, type);
        List<PrintColumn> columns = printColumns(f, type);
        Font bf = wb.createFont();
        bf.setBold(true);
        CellStyle bold = wb.createCellStyle();
        bold.setFont(bf);
        CellStyle head = box(wb, true);
        head.setAlignment(HorizontalAlignment.CENTER);
        CellStyle text = box(wb, false);
        CellStyle qty = box(wb, false);
        qty.setAlignment(HorizontalAlignment.RIGHT);
        CellStyle money = box(wb, false);
        money.setDataFormat(wb.createDataFormat().getFormat("#,##0.00"));
        CellStyle totText = box(wb, true);
        CellStyle hinted = box(wb, false);
        ((org.apache.poi.xssf.usermodel.XSSFCellStyle) hinted).setFillForegroundColor(new org.apache.poi.xssf.usermodel.XSSFColor(new byte[] {(byte) 0xFF, (byte) 0xF4, (byte) 0xCC}, null));
        hinted.setFillPattern(org.apache.poi.ss.usermodel.FillPatternType.SOLID_FOREGROUND);
        CellStyle missing = box(wb, false);
        Font rf = wb.createFont();
        rf.setColor(org.apache.poi.ss.usermodel.IndexedColors.RED.getIndex());
        missing.setFont(rf);
        CellStyle totMoney = box(wb, true);
        totMoney.setDataFormat(wb.createDataFormat().getFormat("#,##0.00"));
        int cols = columns.size();
        int qtyCol = indexOf(columns, "qty");
        int sumCol = type.priced ? indexOf(columns, "total") : -1;
        int r = 0;
        r = line(s, r, type.title, bold, cols);
        r = line(s, r, "Буюртма № " + f.orderNumber() + " · " + DMY.format(f.date()), null, cols);
        r = line(s, r, "Мижоз: " + f.customer() + (f.tin() == null ? "" : " · СТИР " + f.tin()), null, cols);
        r = line(s, r, "Омбор: " + f.warehouse(), null, cols);
        if (f.fefo() && f.rows().stream().anyMatch(x -> x.batchHint() != null || x.shortage() != null)) {
            r = line(s, r, FEFO_NOTE, null, cols);
        }
        r++;
        int headerRow = r;
        Row hr = s.createRow(r++);
        for (int i = 0; i < cols; i++) {
            hr.createCell(i).setCellValue(columns.get(i).title());
            hr.getCell(i).setCellStyle(head);
        }
        for (PrintLine pl : body.lines()) {
            Row row = s.createRow(r++);
            if (!"ROW".equals(pl.kind())) {
                totals(row, cols, totText, totMoney, pl.title(), qtyCol, pl.qty(), sumCol, pl.sum(), "SUBTOTAL".equals(pl.kind()));
                if ("SECTION".equals(pl.kind()) && cols > 1) {
                    s.addMergedRegion(new CellRangeAddress(row.getRowNum(), row.getRowNum(), 0, cols - 1));
                }
                continue;
            }
            FormRow x = pl.row();
            int c = 0;
            for (PrintColumn col : columns) {
                var cell = row.createCell(c++);
                switch (col.key()) {
                    case "no" -> {
                        cell.setCellValue(pl.no());
                        cell.setCellStyle(qty);
                    }
                    case "qty" -> {
                        cell.setCellValue(x.qty());
                        cell.setCellStyle(qty);
                    }
                    case "price" -> {
                        cell.setCellValue(new BigDecimal(x.price() == null ? "0" : x.price()).doubleValue());
                        cell.setCellStyle(money);
                    }
                    case "total" -> {
                        cell.setCellValue(new BigDecimal(x.total() == null ? "0" : x.total()).doubleValue());
                        cell.setCellStyle(money);
                    }
                    case "series" -> text(cell, printSeries(x), x.shortage() != null ? missing : x.batchHint() != null ? hinted : text);
                    case "expiry" -> text(cell, x.expiry(), x.batchHint() != null ? hinted : text);
                    default -> text(cell, cellText(x, col.key()), text);
                }
            }
        }
        totals(s.createRow(r), cols, totText, totMoney, "Жами", qtyCol, body.qty(), sumCol, body.sum(), true);
        for (int i = 0; i < cols; i++) {
            s.setColumnWidth(i, (switch (columns.get(i).key()) {
                case "no" -> 5;
                case "name" -> 42;
                case "manufacturer" -> 24;
                case "area", "farmId", "series", "expiry" -> 14;
                case "qty", "unit" -> 9;
                default -> 16;
            }) * 256);
        }
        s.setRepeatingRows(new CellRangeAddress(headerRow, headerRow, -1, -1));
        s.getPrintSetup().setLandscape(true);
        s.getPrintSetup().setPaperSize(PrintSetup.A4_PAPERSIZE);
        s.setFitToPage(true);
        s.getPrintSetup().setFitWidth((short) 1);
        s.getPrintSetup().setFitHeight((short) 0);
    }

    static int indexOf(List<PrintColumn> columns, String key) {
        for (int i = 0; i < columns.size(); i++) {
            if (columns.get(i).key().equals(key)) {
                return i;
            }
        }
        return -1;
    }

    /** «Жами», «Бўлим жами» yoki boʻlim sarlavhasi qatori: matn birinchi katakda, soni va summa — oʻz ustunida. */
    private static void totals(Row row, int cols, CellStyle text, CellStyle money, String title, int qtyCol, long qty, int sumCol, BigDecimal sum,
            boolean withNumbers) {
        for (int i = 0; i < cols; i++) {
            row.createCell(i).setCellStyle(text);
        }
        row.getCell(0).setCellValue(title);
        if (withNumbers && qtyCol > 0) {
            row.getCell(qtyCol).setCellValue(qty);
        }
        if (withNumbers && sumCol > 0) {
            row.getCell(sumCol).setCellValue(sum.doubleValue());
            row.getCell(sumCol).setCellStyle(money);
        }
    }

    String bulkFileName(List<Long> ids, FormType type) {
        long n = ids == null ? 0 : ids.stream().distinct().count();
        return n == 1 ? fileName(ids.getFirst(), type) : "faktura-" + type.name().toLowerCase(java.util.Locale.ROOT) + "-" + n + ".xlsx";
    }

    String fileName(long id, FormType type) {
        String number = jdbc.sql("SELECT number FROM sales_order WHERE id = :id").param("id", id).query(String.class).optional().orElse("faktura");
        return "faktura-" + type.name().toLowerCase(java.util.Locale.ROOT) + "-" + number.replaceAll("[^A-Za-z0-9-]", "") + ".xlsx";
    }

    private static void text(org.apache.poi.ss.usermodel.Cell cell, String v, CellStyle style) {
        cell.setCellValue(v == null ? "" : v);
        cell.setCellStyle(style);
    }

    private static int line(Sheet s, int r, String text, CellStyle style, int cols) {
        Row row = s.createRow(r);
        row.createCell(0).setCellValue(text);
        if (style != null) {
            row.getCell(0).setCellStyle(style);
        }
        s.addMergedRegion(new CellRangeAddress(r, r, 0, cols - 1));
        return r + 1;
    }

    private static CellStyle box(XSSFWorkbook wb, boolean bold) {
        CellStyle c = wb.createCellStyle();
        c.setBorderTop(BorderStyle.THIN);
        c.setBorderBottom(BorderStyle.THIN);
        c.setBorderLeft(BorderStyle.THIN);
        c.setBorderRight(BorderStyle.THIN);
        c.setVerticalAlignment(VerticalAlignment.CENTER);
        c.setWrapText(true);
        if (bold) {
            Font f = wb.createFont();
            f.setBold(true);
            c.setFont(f);
        }
        return c;
    }
}
