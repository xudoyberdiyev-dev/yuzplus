package uz.yuzplus.catalog.product;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import uz.yuzplus.shared.audit.AuditEntry;
import uz.yuzplus.shared.audit.AuditLog;
import uz.yuzplus.shared.error.YuzplusException;
import uz.yuzplus.shared.settings.SystemSettings;

/**
 * BG1 N2 (egasi 26.11.2026): Sozlamalardagi amaldagi QQS stavkasini barcha mahsulotlarga qoʻllash. QQSdan ozod belgilangan
 * mahsulotlar va narxlar oʻzgarmaydi; oʻtkazilgan hujjatlar oʻz stavkasini saqlaydi. Bitta tranzaksiya + audit.
 */
@RestController
@RequestMapping("/api/products/vat-bulk")
@Tag(name = "products", description = "Mahsulotlar")
class ProductVatController {

    record VatBulkPreview(@Schema(description = "Amaldagi stavka (%), masalan «12»") String rate,
            @Schema(description = "Stavkasi oʻzgaradigan mahsulotlar") long affected,
            @Schema(description = "QQSdan ozod — oʻzgarmaydi") long exempt,
            @Schema(description = "Allaqachon shu stavkada") long same) {}

    record VatBulkApply(@NotBlank @Schema(description = "Oldindan koʻrilgan stavka — amaldagi bilan mos boʻlishi shart") String rate) {}

    record VatBulkResult(String rate, long changed) {}

    private final JdbcClient jdbc;
    private final SystemSettings settings;
    private final AuditLog audit;
    private final Clock clock;

    ProductVatController(JdbcClient jdbc, SystemSettings settings, AuditLog audit, Clock clock) {
        this.jdbc = jdbc;
        this.settings = settings;
        this.audit = audit;
        this.clock = clock;
    }

    private BigDecimal current() {
        return settings.vatRate(LocalDate.now(clock.withZone(ZoneId.of("Asia/Tashkent")))).setScale(2, RoundingMode.HALF_UP);
    }

    static String plain(BigDecimal r) {
        return r.stripTrailingZeros().toPlainString();
    }

    @GetMapping("/preview")
    @PreAuthorize("hasAuthority('settings.edit')")
    @Transactional(readOnly = true)
    @Operation(summary = "QQS stavkasini barcha mahsulotlarga qoʻllash — oldindan koʻrish (nechta mahsulot oʻzgaradi)")
    VatBulkPreview vatBulkPreview() {
        BigDecimal rate = current();
        return jdbc.sql("""
                SELECT count(*) FILTER (WHERE NOT vat_exempt AND vat_rate <> :r) AS affected,
                       count(*) FILTER (WHERE vat_exempt) AS exempt,
                       count(*) FILTER (WHERE NOT vat_exempt AND vat_rate = :r) AS same
                FROM product""")
                .param("r", rate)
                .query((rs, n) -> new VatBulkPreview(plain(rate), rs.getLong("affected"), rs.getLong("exempt"), rs.getLong("same")))
                .single();
    }

    @PostMapping
    @PreAuthorize("hasAuthority('settings.edit')")
    @Transactional
    @Operation(summary = "Amaldagi QQS stavkasini barcha mahsulotlarga qoʻllash",
            description = "QQSdan ozod mahsulotlar va narxlar oʻzgarmaydi. `rate` amaldagi stavkadan farq qilsa — 409 (sozlama oʻzgargan).")
    VatBulkResult vatBulkApply(@Valid @RequestBody VatBulkApply r) {
        BigDecimal rate = current();
        BigDecimal asked;
        try {
            asked = new BigDecimal(r.rate().strip().replace(",", ".")).setScale(2, RoundingMode.HALF_UP);
        } catch (NumberFormatException e) {
            throw YuzplusException.badRequest("validation.vatRate");
        }
        if (asked.compareTo(rate) != 0) {
            throw YuzplusException.conflict("product.vatBulkStale", plain(rate));
        }
        Map<String, Long> before = new LinkedHashMap<>();
        jdbc.sql("""
                SELECT vat_rate, count(*) AS n FROM product WHERE NOT vat_exempt AND vat_rate <> :r
                GROUP BY vat_rate ORDER BY vat_rate""")
                .param("r", rate)
                .query((rs, n) -> before.put(plain(rs.getBigDecimal("vat_rate")) + "%", rs.getLong("n")))
                .list();
        int changed = jdbc.sql("""
                UPDATE product SET vat_rate = :r, updated_at = now(), version = version + 1
                WHERE NOT vat_exempt AND vat_rate <> :r""")
                .param("r", rate)
                .update();
        Map<String, Object> after = new LinkedHashMap<>();
        after.put("rate", plain(rate) + "%");
        after.put("changed", changed);
        audit.record(AuditEntry.of("product.vatBulk", "product", null).change(before, after));
        return new VatBulkResult(plain(rate), changed);
    }
}
