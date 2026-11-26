package uz.yuzplus.sales.order;

import io.swagger.v3.oas.annotations.media.Schema;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.CellCopyPolicy;
import org.apache.poi.ss.usermodel.CellStyle;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.xssf.usermodel.XSSFSheet;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import uz.yuzplus.inventory.StockReservations;
import uz.yuzplus.shared.audit.AuditEntry;
import uz.yuzplus.shared.audit.AuditLog;
import uz.yuzplus.shared.error.YuzplusException;
import uz.yuzplus.shared.pdf.PdfRenderer;
import uz.yuzplus.shared.pdf.PrintSettings;
import uz.yuzplus.shared.security.Actor;

/**
 * FT6 (egasi 26.11.2026): mijoz hujjatlari toʻplami — hisob varaq-faktura, tijorat taklifi, spetsifikatsiya. Shablon — egasi namunasi
 * ({@code docs/notes/ft/namuna/1478-*.xls}) .xlsx ko'rinishida ({@code templates/client-docs/}); faqat o'zgaruvchi kataklar to'ldiriladi
 * va tovar qatorlari ko'paytiriladi. Buyurtmaning <b>hozirgi</b> holatidan: sotuv bo'lsa — sotuv qatorlari, yig'ilgan bo'lsa — yig'ilgan
 * partiyalar, zahiralangan bo'lsa — zahira, qoralamada — FEFO taklifi. Hisob — {@link ClientDocMath}. Hech narsa o'zgarmaydi (faqat fayl).
 */
@Service
class ClientDocs {

    enum Kind {
        INVOICE("hisob-varaq-faktura"),
        OFFER("tijorat-taklifi"),
        SPECIFICATION("spetsifikatsiya");

        final String file;

        Kind(String file) {
            this.file = file;
        }
    }

    record ContractOption(long id, String number, @Schema(nullable = true) LocalDate signedOn, @Schema(nullable = true) LocalDate validUntil) {}

    record ClientDocsInfo(
            @Schema(nullable = true, description = "Tanlangan shartnoma; null — hujjat chiqarishdan oldin tanlanadi") ContractOption contract,
            @Schema(description = "Mijozning shu filialdagi shartnomalari (yangi → eski)") List<ContractOption> contracts,
            @Schema(nullable = true, description = "Tavsiya: amaldagi eng yangi shartnoma") Long suggestedContractId,
            @Schema(description = "Bo'sh rekvizitlar (i18n kalit qismlari): sellerIfut, sellerDirector, sellerAccountant, sellerBank, "
                    + "buyerAccount, buyerMfo, buyerBank, noCost") List<String> missing,
            int lines) {}

    record ContractRequest(@jakarta.validation.constraints.NotNull(message = "{validation.required}") Long contractId) {}

    /** Hujjat ma'lumoti (testlar va fayl uchun). */
    record Party(String name, String address, String phone, String account, String mfo, String bank, String tin, String ifut,
            String treasuryAccount, String treasuryTin) {}

    record DocLine(int no, String name, String unit, String ikpu, ClientDocMath.Line calc) {}

    record Doc(long orderId, String orderNumber, String contractNumber, LocalDate contractDate, LocalDate docDate, Party seller, Party buyer,
            String director, String accountant, List<DocLine> lines, ClientDocMath.Totals totals, String words) {}

    private record Head(long id, String number, long branchId, String status, LocalDate orderDate, long customerId, long warehouseId,
            Long saleId, LocalDate saleDate, Long contractId, String contractNumber, LocalDate contractDate) {}

    private static final String[] MONTHS = {"yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avgust", "sentabr", "oktabr", "noyabr",
        "dekabr"};
    private static final java.util.Set<String> PROPOSAL_STATUSES = java.util.Set.of("DRAFT", "PENDING_APPROVAL");
    private static final java.util.Set<String> DEAD_STATUSES = java.util.Set.of("CANCELLED", "REJECTED");
    private static final String MONEY_FORMAT = "#,##0.00";

    private final JdbcClient jdbc;
    private final AuditLog audit;
    private final StockReservations reservations;
    private final PrintSettings printSettings;
    private final java.time.Clock clock;
    private final PdfRenderer pdfRenderer;

    ClientDocs(JdbcClient jdbc, AuditLog audit, StockReservations reservations, PrintSettings printSettings, java.time.Clock clock,
            PdfRenderer pdfRenderer) {
        this.pdfRenderer = pdfRenderer;
        this.jdbc = jdbc;
        this.audit = audit;
        this.reservations = reservations;
        this.printSettings = printSettings;
        this.clock = clock;
    }

    // ===== Ma'lumot =====

    private Head head(Actor actor, long id) {
        return jdbc.sql("""
                SELECT o.id, o.number, o.branch_id, o.status, o.order_date, o.customer_id, o.warehouse_id, s.id AS sale_id, s.sale_date,
                       k.id AS contract_id, k.number AS contract_number, k.signed_on AS contract_date
                FROM sales_order o
                LEFT JOIN sale s ON s.order_id = o.id AND s.status = 'POSTED'
                LEFT JOIN sales_order_contract oc ON oc.order_id = o.id
                LEFT JOIN counterparty_contract k ON k.id = oc.contract_id
                WHERE o.id = :id""")
                .param("id", id)
                .query((rs, n) -> new Head(rs.getLong("id"), rs.getString("number"), rs.getLong("branch_id"), rs.getString("status"),
                        rs.getObject("order_date", LocalDate.class), rs.getLong("customer_id"), rs.getLong("warehouse_id"),
                        (Long) rs.getObject("sale_id"), rs.getObject("sale_date", LocalDate.class), (Long) rs.getObject("contract_id"),
                        rs.getString("contract_number"), rs.getObject("contract_date", LocalDate.class)))
                .optional()
                .filter(h -> actor.canAccessBranch(h.branchId()))
                .orElseThrow(() -> YuzplusException.notFound("error.notFound"));
    }

    private List<ContractOption> contracts(Head h) {
        return jdbc.sql("""
                SELECT id, number, signed_on, valid_until FROM counterparty_contract
                WHERE counterparty_id = :c AND branch_id = :b ORDER BY signed_on DESC NULLS LAST, id DESC""")
                .param("c", h.customerId())
                .param("b", h.branchId())
                .query((rs, n) -> new ContractOption(rs.getLong("id"), rs.getString("number"), rs.getObject("signed_on", LocalDate.class),
                        rs.getObject("valid_until", LocalDate.class)))
                .list();
    }

    @Transactional(readOnly = true)
    ClientDocsInfo info(Actor actor, long id) {
        Head h = head(actor, id);
        List<ContractOption> all = contracts(h);
        LocalDate on = docDate(h);
        Long suggested = all.stream()
                .filter(c -> (c.signedOn() == null || !c.signedOn().isAfter(on)) && (c.validUntil() == null || !c.validUntil().isBefore(on)))
                .map(ContractOption::id)
                .findFirst()
                .orElse(all.isEmpty() ? null : all.getFirst().id());
        ContractOption current = h.contractId() == null ? null
                : all.stream().filter(c -> c.id() == h.contractId()).findFirst()
                        .orElse(new ContractOption(h.contractId(), h.contractNumber(), h.contractDate(), null));
        Doc d = build(h, current == null ? "" : current.number(), current == null ? null : current.signedOn());
        List<String> missing = new ArrayList<>();
        if (blank(d.seller().ifut())) {
            missing.add("sellerIfut");
        }
        if (blank(d.director())) {
            missing.add("sellerDirector");
        }
        if (blank(d.accountant())) {
            missing.add("sellerAccountant");
        }
        if (blank(d.seller().account())) {
            missing.add("sellerBank");
        }
        if (blank(d.buyer().account())) {
            missing.add("buyerAccount");
        }
        if (blank(d.buyer().mfo())) {
            missing.add("buyerMfo");
        }
        if (blank(d.buyer().bank())) {
            missing.add("buyerBank");
        }
        if (d.lines().stream().anyMatch(l -> l.calc().base() == null)) {
            missing.add("noCost");
        }
        return new ClientDocsInfo(current, all, suggested, missing, d.lines().size());
    }

    @Transactional
    ClientDocsInfo setContract(Actor actor, long id, long contractId) {
        Head h = head(actor, id);
        boolean ok = jdbc.sql("SELECT EXISTS (SELECT 1 FROM counterparty_contract WHERE id = :k AND counterparty_id = :c AND branch_id = :b)")
                .param("k", contractId)
                .param("c", h.customerId())
                .param("b", h.branchId())
                .query(Boolean.class)
                .single();
        if (!ok) {
            throw YuzplusException.badRequest("clientDocs.contractInvalid");
        }
        jdbc.sql("""
                INSERT INTO sales_order_contract (order_id, contract_id, updated_by, updated_at) VALUES (:o, :k, :e, now())
                ON CONFLICT (order_id) DO UPDATE SET contract_id = :k, updated_by = :e, updated_at = now()""")
                .param("o", id)
                .param("k", contractId)
                .param("e", actor.employeeId())
                .update();
        Map<String, Object> before = new HashMap<>();
        before.put("contractId", h.contractId());
        audit.record(AuditEntry.of("order.clientDocsContract", "sales_order", id).change(before, Map.of("contractId", contractId)));
        return info(actor, id);
    }

    /** Hujjat ma'lumoti; shartnoma tanlanmagan bo'lsa — xato (hujjat raqami shartnomadan). */
    @Transactional(readOnly = true)
    Doc doc(Actor actor, long id) {
        Head h = head(actor, id);
        if (h.contractId() == null) {
            throw YuzplusException.badRequest("clientDocs.contractRequired");
        }
        return build(h, h.contractNumber(), h.contractDate());
    }

    private static LocalDate docDate(Head h) {
        return h.saleDate() != null ? h.saleDate() : h.orderDate();
    }

    private Doc build(Head h, String contractNumber, LocalDate contractDate) {
        record P(String name, String address, String phone, String account, String mfo, String bank, String tin, String ifut, String director,
                String accountant) {}
        P s = jdbc.sql("""
                SELECT coalesce(nullif(btrim(br.legal_name), ''), br.name) AS name, coalesce(br.address, br.actual_address) AS address, br.phone,
                       ba.account, ba.mfo, ba.bank_name AS bank, br.tin, br.ifut, br.director_name AS director, br.accountant_name AS accountant
                FROM branch br
                LEFT JOIN LATERAL (SELECT b.bank_name, b.account, b.mfo FROM branch_bank_account b WHERE b.branch_id = br.id
                        ORDER BY b.is_main DESC, b.sort_order, b.id LIMIT 1) ba ON true
                WHERE br.id = :b""")
                .param("b", h.branchId())
                .query(P.class)
                .single();
        Party seller = new Party(s.name(), s.address(), s.phone(), s.account(), s.mfo(), s.bank(), s.tin(), s.ifut(), null, null);
        Party buyer = jdbc.sql("""
                SELECT coalesce(nullif(btrim(c.legal_name), ''), c.name) AS name, c.address, c.phone, c.bank_account AS account, c.bank_mfo AS mfo,
                       c.bank_name AS bank, c.tin, NULL AS ifut, c.treasury_account, c.treasury_tin
                FROM counterparty c WHERE c.id = :c""")
                .param("c", h.customerId())
                .query(Party.class)
                .single();
        PrintSettings.Signers signers = printSettings.signers(h.branchId());
        String director = blank(s.director()) ? signers.head() : s.director();
        String accountant = blank(s.accountant()) ? signers.accountant() : s.accountant();
        List<DocLine> lines = lines(h);
        ClientDocMath.Totals totals = ClientDocMath.totals(lines.stream().map(DocLine::calc).toList());
        return new Doc(h.id(), h.number(), contractNumber, contractDate, docDate(h), seller, buyer, director, accountant, lines, totals,
                ClientDocMath.words(totals.gross()));
    }

    private record OrderLine(long id, long productId, String name, String unit, String ikpu, int qty, BigDecimal price, BigDecimal vatRate) {}

    /** Partiya ulushi: soni va kirim narxi. */
    private record Part(long lineId, int qty, BigDecimal cost) {}

    private List<DocLine> lines(Head h) {
        List<OrderLine> lines = jdbc.sql("""
                SELECT l.id, l.product_id, p.name, coalesce(u.short_name, u.name) AS unit, p.ikpu, l.qty, l.price,
                       CASE WHEN p.vat_exempt THEN 0 ELSE p.vat_rate END AS vat_rate
                FROM sales_order_line l JOIN product p ON p.id = l.product_id LEFT JOIN unit u ON u.id = p.unit_id
                WHERE l.order_id = :o ORDER BY l.line_no, l.id""")
                .param("o", h.id())
                .query((rs, n) -> new OrderLine(rs.getLong("id"), rs.getLong("product_id"), rs.getString("name"), rs.getString("unit"),
                        rs.getString("ikpu"), rs.getInt("qty"), rs.getBigDecimal("price"), rs.getBigDecimal("vat_rate")))
                .list();
        Map<Long, BigDecimal> saleVat = new HashMap<>();
        Map<Long, List<Part>> parts = parts(h, lines, saleVat);
        boolean byParts = h.saleId() != null || picked(h.id());
        List<DocLine> out = new ArrayList<>();
        int no = 0;
        for (OrderLine l : lines) {
            List<Part> ps = parts.getOrDefault(l.id(), List.of());
            int qty = byParts ? ps.stream().mapToInt(Part::qty).sum() : l.qty();
            if (qty <= 0 || l.price() == null) {
                continue;
            }
            BigDecimal cost = weighted(ps);
            BigDecimal rate = saleVat.getOrDefault(l.id(), l.vatRate());
            ClientDocMath.Line calc = ClientDocMath.line(new ClientDocMath.In(qty, l.price(), rate, cost));
            out.add(new DocLine(++no, l.name(), l.unit(), l.ikpu(), calc));
        }
        return out;
    }

    private boolean picked(long orderId) {
        return jdbc.sql("SELECT EXISTS (SELECT 1 FROM sales_order_pick WHERE order_id = :o)").param("o", orderId).query(Boolean.class).single();
    }

    /** Qator → partiyalar (soni, kirim narxi): sotuv → yig'ilgan → zahira → FEFO taklifi. */
    private Map<Long, List<Part>> parts(Head h, List<OrderLine> lines, Map<Long, BigDecimal> saleVat) {
        Map<Long, List<Part>> out = new LinkedHashMap<>();
        if (h.saleId() != null) {
            jdbc.sql("SELECT order_line_id, qty, cost, vat_rate FROM sale_line WHERE sale_id = :s ORDER BY id")
                    .param("s", h.saleId())
                    .query((rs, n) -> {
                        saleVat.put(rs.getLong("order_line_id"), rs.getBigDecimal("vat_rate"));
                        return new Part(rs.getLong("order_line_id"), rs.getInt("qty"), rs.getBigDecimal("cost"));
                    })
                    .list()
                    .forEach(p -> out.computeIfAbsent(p.lineId(), k -> new ArrayList<>()).add(p));
            return out;
        }
        if (picked(h.id())) {
            jdbc.sql("""
                    SELECT x.line_id, sum(x.qty)::int AS qty, b.cost FROM (
                        SELECT line_id, batch_id, qty FROM sales_order_pick WHERE order_id = :o
                        UNION ALL
                        SELECT k.line_id, r.batch_id, -r.qty FROM sales_order_pick_return r
                        JOIN LATERAL (SELECT line_id FROM sales_order_pick WHERE order_id = r.order_id AND batch_id = r.batch_id
                                ORDER BY id LIMIT 1) k ON true
                        WHERE r.order_id = :o) x
                    JOIN batch b ON b.id = x.batch_id
                    GROUP BY x.line_id, x.batch_id, b.cost HAVING sum(x.qty) > 0 ORDER BY x.line_id, x.batch_id""")
                    .param("o", h.id())
                    .query((rs, n) -> new Part(rs.getLong("line_id"), rs.getInt("qty"), rs.getBigDecimal("cost")))
                    .list()
                    .forEach(p -> out.computeIfAbsent(p.lineId(), k -> new ArrayList<>()).add(p));
            return out;
        }
        if (DEAD_STATUSES.contains(h.status())) {
            return out;
        }
        Map<Long, Integer> batchQty = new LinkedHashMap<>();
        List<long[]> alloc = new ArrayList<>(); // lineId, batchId, qty
        if (PROPOSAL_STATUSES.contains(h.status())) {
            Map<Long, Integer> need = new LinkedHashMap<>();
            lines.forEach(l -> need.merge(l.productId(), l.qty(), Integer::sum));
            Map<Long, java.util.ArrayDeque<long[]>> pool = new HashMap<>();
            reservations.plan(h.warehouseId(), LocalDate.now(clock.withZone(java.time.ZoneId.of("Asia/Tashkent"))), need)
                    .forEach((product, planned) -> pool.put(product, planned.stream().map(x -> new long[] {x.batchId(), x.qty()})
                            .collect(java.util.stream.Collectors.toCollection(java.util.ArrayDeque::new))));
            for (OrderLine l : lines) {
                java.util.ArrayDeque<long[]> q = pool.getOrDefault(l.productId(), new java.util.ArrayDeque<>());
                int left = l.qty();
                while (left > 0 && !q.isEmpty()) {
                    long[] top = q.peekFirst();
                    int take = (int) Math.min(left, top[1]);
                    alloc.add(new long[] {l.id(), top[0], take});
                    top[1] -= take;
                    left -= take;
                    if (top[1] == 0) {
                        q.pollFirst();
                    }
                }
            }
        } else {
            for (StockReservations.Allocation a : reservations.active(Orders.DOC_TYPE, h.id())) {
                alloc.add(new long[] {a.lineId(), a.batchId(), a.qty()});
            }
        }
        alloc.forEach(a -> batchQty.put(a[1], 0));
        Map<Long, BigDecimal> costs = new HashMap<>();
        if (!batchQty.isEmpty()) {
            jdbc.sql("SELECT id, cost FROM batch WHERE id IN (:ids)")
                    .param("ids", batchQty.keySet())
                    .query((rs, n) -> Map.entry(rs.getLong("id"), rs.getBigDecimal("cost")))
                    .list()
                    .forEach(e -> costs.put(e.getKey(), e.getValue()));
        }
        for (long[] a : alloc) {
            out.computeIfAbsent(a[0], k -> new ArrayList<>()).add(new Part(a[0], (int) a[2], costs.get(a[1])));
        }
        return out;
    }

    /** Partiyalar bo'yicha vaznli o'rtacha kirim narxi, 2 xona HALF_UP; partiya yo'q bo'lsa — {@code null}. */
    static BigDecimal weightedCost(List<long[]> qtyAndCostTiyin) {
        long qty = 0;
        BigDecimal sum = BigDecimal.ZERO;
        for (long[] x : qtyAndCostTiyin) {
            qty += x[0];
            sum = sum.add(BigDecimal.valueOf(x[1], 2).multiply(BigDecimal.valueOf(x[0])));
        }
        return qty == 0 ? null : sum.divide(BigDecimal.valueOf(qty), 2, RoundingMode.HALF_UP);
    }

    private static BigDecimal weighted(List<Part> parts) {
        List<long[]> xs = new ArrayList<>();
        for (Part p : parts) {
            if (p.qty() > 0 && p.cost() != null) {
                xs.add(new long[] {p.qty(), p.cost().movePointRight(2).setScale(0, RoundingMode.HALF_UP).longValueExact()});
            }
        }
        return weightedCost(xs);
    }

    // ===== Fayllar =====

    String fileName(Doc d, Kind kind) {
        return fileName(d, kind, "xlsx");
    }

    String fileName(Doc d, Kind kind, String ext) {
        return safe(d.contractNumber()) + "-" + kind.file + "." + ext;
    }

    String zipName(Doc d) {
        return safe(d.orderNumber()) + "-hujjatlar.zip";
    }

    private static String safe(String s) {
        return s == null || s.isBlank() ? "hujjat" : s.strip().replaceAll("[^0-9A-Za-z._-]", "_");
    }

    byte[] xlsx(Doc d, Kind kind) {
        try (InputStream in = ClientDocs.class.getResourceAsStream("/templates/client-docs/" + kind.file + ".xlsx");
                XSSFWorkbook wb = new XSSFWorkbook(java.util.Objects.requireNonNull(in, kind.file));
                ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            XSSFSheet sheet = wb.getSheetAt(0);
            switch (kind) {
                case INVOICE -> invoice(wb, sheet, d);
                case OFFER -> offer(wb, sheet, d);
                case SPECIFICATION -> specification(wb, sheet, d);
            }
            wb.write(out);
            return out.toByteArray();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    byte[] zip(Doc d) {
        try (ByteArrayOutputStream out = new ByteArrayOutputStream(); ZipOutputStream zip = new ZipOutputStream(out)) {
            for (Kind k : Kind.values()) {
                zip.putNextEntry(new ZipEntry(fileName(d, k)));
                zip.write(xlsx(d, k));
                zip.closeEntry();
            }
            for (Kind k : Kind.values()) {
                zip.putNextEntry(new ZipEntry(fileName(d, k, "pdf")));
                zip.write(pdf(d, k));
                zip.closeEntry();
            }
            zip.finish();
            return out.toByteArray();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    // ===== Matnlar (Excel va PDF uchun bir xil) =====

    private static String invoiceTitle(Doc d) {
        return "HISOB VARAQ FAKTURA № " + nz(d.contractNumber());
    }

    private static String invoiceDate(Doc d) {
        return "Sana " + date(d.docDate(), d.docDate().getYear());
    }

    private static String invoiceBasis(Doc d) {
        return "№ " + nz(d.contractNumber()) + " sonli shartnomaga asosan  " + date(d.contractDate(), d.docDate().getYear());
    }

    private static String specDate(Doc d) {
        LocalDate c = d.contractDate();
        int year = c != null ? c.getYear() : d.docDate().getYear();
        return c == null ? year + " yil «____» ______________ dagi" : year + " yil «" + two(c.getDayOfMonth()) + "» " + MONTHS[c.getMonthValue() - 1]
                + " dagi";
    }

    private static String offerRequisites(Party s) {
        return nz(s.address()) + ", H/R " + nz(s.account()) + ", STIR " + nz(s.tin()) + ", МФО " + nz(s.mfo());
    }

    private static String offerNumber(Doc d) {
        return "№ " + nz(d.contractNumber()) + " " + date(d.docDate(), d.docDate().getYear());
    }

    private static String offerIntro(Party s) {
        return nz(s.name()) + " sizga o'z omboridan xorijda va respublika farmsanoatida ishlab chiqarilgan quyidagi sifatli dori-darmonlarni "
                + "taklif qiladi";
    }

    private static String vatText(ClientDocMath.Line c) {
        return c.vatFree() ? "QQSsiz" : c.vatRate().stripTrailingZeros().toPlainString() + "%";
    }

    /** Namunadagidek: «1 629 000,00» (minglar bo'sh joy bilan, vergul). */
    static String num(BigDecimal v) {
        if (v == null) {
            return "";
        }
        String plain = v.setScale(2, RoundingMode.HALF_UP).abs().toPlainString();
        String intPart = plain.substring(0, plain.indexOf('.'));
        StringBuilder sb = new StringBuilder();
        int lead = intPart.length() % 3;
        for (int i = 0; i < intPart.length(); i++) {
            if (i > 0 && (i - lead) % 3 == 0) {
                sb.append(' ');
            }
            sb.append(intPart.charAt(i));
        }
        return (v.signum() < 0 ? "-" : "") + sb + "," + plain.substring(plain.indexOf('.') + 1);
    }

    byte[] pdf(Doc d, Kind kind) {
        Map<String, Object> v = new HashMap<>();
        Party s = d.seller();
        Party b = d.buyer();
        v.put("kind", kind.name());
        v.put("seller", Map.of("name", nz(s.name()), "bank", nz(s.bank())));
        v.put("director", nz(d.director()));
        v.put("accountant", nz(d.accountant()));
        v.put("offerRequisites", offerRequisites(s));
        v.put("offerNumber", offerNumber(d));
        v.put("offerIntro", offerIntro(s));
        if (kind == Kind.SPECIFICATION) {
            v.put("title", "S P E T S I F I K A T S I Y A");
            v.put("subtitles", List.of(specDate(d), nz(d.contractNumber()) + " sonli shartnomaga", "1- sonli ilova"));
        } else {
            v.put("title", kind == Kind.OFFER ? "TIJORAT TAKLIFI" : invoiceTitle(d));
            v.put("subtitles", List.of(invoiceDate(d), invoiceBasis(d)));
        }
        String[][] req = {
            {"Nomi:", s.name(), "Nomi:", b.name()},
            {"Manzil:", s.address(), "Manzil:", b.address()},
            {"Telefon:", s.phone(), "Telefon:", b.phone()},
            {"H/R:", s.account(), "H/R:", b.account()},
            {"MFO:", s.mfo(), "MFO:", b.mfo()},
            {"IFUT:", s.ifut(), "STIR:", b.tin()},
            {"Bank:", s.bank(), "G'azna H/R:", b.treasuryAccount()},
            {"STIR:", s.tin(), "Bank:", b.bank()},
            {"", "", "STIR:", b.treasuryTin()},
        };
        List<List<String>> requisites = new ArrayList<>();
        for (String[] r : req) {
            requisites.add(java.util.Arrays.stream(r).map(ClientDocs::nz).toList());
        }
        v.put("requisites", requisites);
        List<Map<String, Object>> lines = new ArrayList<>();
        for (DocLine l : d.lines()) {
            ClientDocMath.Line c = l.calc();
            Map<String, Object> m = new HashMap<>();
            m.put("no", l.no());
            m.put("name", nz(l.name()));
            m.put("unit", nz(l.unit()));
            m.put("ikpu", nz(l.ikpu()));
            m.put("qty", num(BigDecimal.valueOf(c.qty())));
            m.put("base", num(c.base()));
            m.put("markup", num(c.markup()));
            m.put("sell", num(c.sell()));
            m.put("net", num(c.net()));
            m.put("vatRate", vatText(c));
            m.put("vat", num(c.vat()));
            m.put("gross", num(c.gross()));
            m.put("offer", num(c.offerPrice()));
            lines.add(m);
        }
        v.put("lines", lines);
        v.put("net", num(d.totals().net()));
        v.put("vat", num(d.totals().vat()));
        v.put("gross", num(d.totals().gross()));
        v.put("words", "JAMI: " + d.words());
        return pdfRenderer.render("client-doc", v);
    }

    /** Shablondagi qator raqamlari (0 dan): tovar qatori va undan keyingi qatorlar {@code n − 1} ga suriladi. */
    static final int INVOICE_ITEM_ROW = 18;
    static final int OFFER_ITEM_ROW = 15;
    static final int SPEC_ITEM_ROW = 19;

    private static void invoice(XSSFWorkbook wb, XSSFSheet sh, Doc d) {
        text(sh, 0, 0, invoiceTitle(d));
        text(sh, 1, 0, invoiceDate(d));
        text(sh, 2, 0, invoiceBasis(d));
        parties(sh, d);
        int shift = items(wb, sh, INVOICE_ITEM_ROW, d, true);
        int total = INVOICE_ITEM_ROW + 1 + shift;
        totals(wb, sh, total, d);
        text(sh, total + 1, 0, "JAMI: " + d.words());
        text(sh, 25 + shift, 1, "Rahbar _________________________________ " + nz(d.director()));
        text(sh, 27 + shift, 1, "Bosh hisobchi ___________________________ " + nz(d.accountant()));
    }

    private static void specification(XSSFWorkbook wb, XSSFSheet sh, Doc d) {
        text(sh, 1, 0, specDate(d));
        text(sh, 2, 8, nz(d.contractNumber()) + " sonli shartnomaga");
        parties(sh, d);
        int shift = items(wb, sh, SPEC_ITEM_ROW, d, false);
        int total = SPEC_ITEM_ROW + 1 + shift;
        totals(wb, sh, total, d);
        text(sh, total + 1, 0, "JAMI: " + d.words());
    }

    private static void offer(XSSFWorkbook wb, XSSFSheet sh, Doc d) {
        Party s = d.seller();
        text(sh, 4, 1, nz(s.name()));
        text(sh, 5, 1, offerRequisites(s));
        text(sh, 6, 1, nz(s.bank()));
        text(sh, 7, 1, offerNumber(d));
        text(sh, 11, 1, offerIntro(s));
        int n = d.lines().size();
        int shift = expand(sh, OFFER_ITEM_ROW, n);
        CellStyle money = format(wb, sh, OFFER_ITEM_ROW, 5);
        for (int i = 0; i < n; i++) {
            DocLine l = d.lines().get(i);
            int r = OFFER_ITEM_ROW + i;
            number(sh, r, 1, l.no(), null);
            text(sh, r, 2, nz(l.name()));
            text(sh, r, 3, nz(l.unit()));
            number(sh, r, 4, 1, null);
            money(sh, r, 5, l.calc().offerPrice(), money);
            height(sh, r, l.name(), 50, 15.75f, 16f);
        }
        text(sh, 19 + shift, 1, nz(s.name()) + " direktori:  ____________________");
        text(sh, 19 + shift, 4, nz(d.director()));
    }

    /** Ikkala tomon rekvizitlari (faktura va spetsifikatsiyada bir xil joyda). */
    private static void parties(XSSFSheet sh, Doc d) {
        Party s = d.seller();
        String[] seller = {s.name(), s.address(), s.phone(), s.account(), s.mfo(), s.ifut(), s.bank(), s.tin()};
        for (int i = 0; i < seller.length; i++) {
            text(sh, 6 + i, 2, nz(seller[i]));
        }
        Party b = d.buyer();
        String[] buyer = {b.name(), b.address(), b.phone(), b.account(), b.mfo(), b.tin(), b.treasuryAccount(), b.bank(), b.treasuryTin()};
        for (int i = 0; i < buyer.length; i++) {
            text(sh, 6 + i, 8, nz(buyer[i]));
        }
    }

    /** Faktura/spetsifikatsiya tovar qatorlari; qaytaradi — keyingi qatorlar qanchaga surilgani. */
    private static int items(XSSFWorkbook wb, XSSFSheet sh, int first, Doc d, boolean ikpu) {
        int n = d.lines().size();
        int shift = expand(sh, first, n);
        CellStyle qtyStyle = format(wb, sh, first, 4);
        Map<Integer, CellStyle> money = new HashMap<>();
        for (int c : new int[] {5, 6, 7, 8, 10, 11}) {
            money.put(c, format(wb, sh, first, c));
        }
        for (int i = 0; i < n; i++) {
            DocLine l = d.lines().get(i);
            ClientDocMath.Line c = l.calc();
            int r = first + i;
            number(sh, r, 0, l.no(), null);
            text(sh, r, 1, nz(l.name()));
            text(sh, r, 3, nz(l.unit()));
            money(sh, r, 4, BigDecimal.valueOf(c.qty()), qtyStyle);
            money(sh, r, 5, c.base(), money.get(5));
            money(sh, r, 6, c.markup(), money.get(6));
            money(sh, r, 7, c.sell(), money.get(7));
            money(sh, r, 8, c.net(), money.get(8));
            text(sh, r, 9, vatText(c));
            money(sh, r, 10, c.vat(), money.get(10));
            money(sh, r, 11, c.gross(), money.get(11));
            if (ikpu) {
                text(sh, r, 12, nz(l.ikpu()));
            }
            height(sh, r, l.name(), 40, 27f, 26f);
        }
        return shift;
    }

    private static void totals(XSSFWorkbook wb, XSSFSheet sh, int row, Doc d) {
        money(sh, row, 8, d.totals().net(), format(wb, sh, row, 8));
        money(sh, row, 10, d.totals().vat(), format(wb, sh, row, 10));
        money(sh, row, 11, d.totals().gross(), format(wb, sh, row, 11));
    }

    /** Shablondagi bitta tovar qatorini {@code n} ta qilish: pastdagi qatorlar suriladi, qator (uslubi va birlashtirishlari bilan) nusxalanadi. */
    private static int expand(XSSFSheet sh, int first, int n) {
        int shift = Math.max(0, n - 1);
        if (shift == 0) {
            return 0;
        }
        sh.shiftRows(first + 1, sh.getLastRowNum(), shift, true, false);
        CellCopyPolicy policy = new CellCopyPolicy.Builder().cellValue(false).cellStyle(true).mergedRegions(true).rowHeight(true).build();
        for (int i = 1; i <= shift; i++) {
            sh.copyRows(first, first, first + i, policy);
        }
        return shift;
    }

    /** Uzun nom — bir necha qator: namunadagidek balandlik (bir qator — {@code one}, aks holda {@code per} × qatorlar). */
    private static void height(XSSFSheet sh, int r, String name, int chars, float one, float per) {
        int len = name == null ? 0 : name.strip().length();
        int lines = Math.max(1, (len + chars - 1) / chars);
        sh.getRow(r).setHeightInPoints(lines == 1 ? one : per * lines);
    }

    private static CellStyle format(XSSFWorkbook wb, XSSFSheet sh, int r, int c) {
        CellStyle base = cell(sh, r, c).getCellStyle();
        CellStyle s = wb.createCellStyle();
        s.cloneStyleFrom(base);
        s.setDataFormat(wb.createDataFormat().getFormat(MONEY_FORMAT));
        return s;
    }

    private static Cell cell(XSSFSheet sh, int r, int c) {
        Row row = sh.getRow(r);
        if (row == null) {
            row = sh.createRow(r);
        }
        Cell cell = row.getCell(c);
        return cell == null ? row.createCell(c) : cell;
    }

    private static void text(XSSFSheet sh, int r, int c, String v) {
        cell(sh, r, c).setCellValue(v);
    }

    private static void number(XSSFSheet sh, int r, int c, long v, CellStyle style) {
        Cell cell = cell(sh, r, c);
        cell.setCellValue(v);
        if (style != null) {
            cell.setCellStyle(style);
        }
    }

    private static void money(XSSFSheet sh, int r, int c, BigDecimal v, CellStyle style) {
        Cell cell = cell(sh, r, c);
        if (v == null) {
            cell.setBlank();
            return;
        }
        cell.setCellValue(v.doubleValue());
        cell.setCellStyle(style);
    }

    /** «26» noyabr 2026 yil; sana yo'q — namunadagidek «___» ______ YYYY yil. */
    static String date(LocalDate d, int year) {
        if (d == null) {
            return "«___» ______ " + year + " yil";
        }
        return "«" + two(d.getDayOfMonth()) + "» " + MONTHS[d.getMonthValue() - 1] + " " + d.getYear() + " yil";
    }

    private static String two(int v) {
        return v < 10 ? "0" + v : Integer.toString(v);
    }

    private static String nz(String s) {
        return s == null ? "" : s.strip();
    }

    private static boolean blank(String s) {
        return s == null || s.isBlank();
    }
}
