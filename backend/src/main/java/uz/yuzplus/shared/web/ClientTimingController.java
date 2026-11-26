package uz.yuzplus.shared.web;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.Set;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * TZ1 (tezlik oʻlchovi): brauzer oʻzi koʻrgan sekin API soʻrovlari (tarmoq + Vercel rewrite + server) va Web Vitals (LCP, INP, CLS…)
 * qaydlarini yuboradi — ular WARN «slow-client» bilan Railway logiga yoziladi. Server vaqti ({@link SlowRequestLog}) bilan
 * solishtirib, sekinlik tarmoqdami yoki serverdami — koʻriladi. Bazaga hech narsa yozilmaydi; soʻrov satri, raqamli ID va
 * matn yozilmaydi (nom tozalanadi), bitta yuborishda eng koʻpi {@value #MAX_ENTRIES} ta qayd.
 */
@RestController
@RequestMapping("/api/telemetry")
@Tag(name = "telemetry", description = "Tezlik oʻlchovi (brauzer)")
class ClientTimingController {

    static final int MAX_ENTRIES = 20;
    private static final int MAX_NAME = 120;
    private static final long MAX_MS = 600_000;
    private static final Pattern SAFE = Pattern.compile("[^A-Za-z0-9/_{}.:\\-]");
    private static final Pattern NUMBER_SEGMENT = Pattern.compile("/\\d+(?=/|$)");
    private static final Set<String> METHODS = Set.of("GET", "POST", "PUT", "PATCH", "DELETE");
    private static final Logger LOG = LoggerFactory.getLogger(ClientTimingController.class);

    record TimingEntry(
            @Schema(description = "api — sekin soʻrov, vital — Web Vitals", allowableValues = {"api", "vital"}) String kind,
            @Schema(description = "API yoʻli (masalan GET /api/orders/{id}) yoki koʻrsatkich nomi (LCP)") String name,
            @Schema(description = "Davomiylik, ms (CLS uchun ×1000)") long ms,
            @Schema(nullable = true, description = "HTTP holati (api uchun)") Integer status,
            @Schema(nullable = true, description = "Sahifa yoʻli (masalan /orders/{id})") String page) {}

    record TimingReport(List<TimingEntry> entries) {}

    @PostMapping("/timings")
    @PreAuthorize("isAuthenticated()")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Operation(summary = "Brauzerdagi sekin soʻrovlar va Web Vitals qaydlari (faqat log)")
    void timings(@RequestBody TimingReport report) {
        if (report == null || report.entries() == null) {
            return;
        }
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        String user = auth == null ? null : auth.getName();
        report.entries().stream().limit(MAX_ENTRIES).map(e -> line(e, user)).filter(Objects::nonNull).forEach(LOG::warn);
    }

    /** Log qatori: {@code slow-client api GET /api/orders/{id} ms=2310 status=200 page=/orders/{id} user=operator1}; yaroqsiz qayd — null. */
    static String line(TimingEntry e, String user) {
        if (e == null || e.ms() < 0 || e.ms() > MAX_MS) {
            return null;
        }
        String kind = "vital".equals(e.kind()) ? "vital" : "api".equals(e.kind()) ? "api" : null;
        String name = kind == null ? null : kind.equals("api") ? apiName(e.name()) : clean(e.name());
        if (name == null) {
            return null;
        }
        StringBuilder sb = new StringBuilder("slow-client ").append(kind).append(' ').append(name).append(" ms=").append(e.ms());
        if (e.status() != null && e.status() >= 0 && e.status() < 1000) {
            sb.append(" status=").append(e.status());
        }
        String page = clean(e.page());
        if (page != null) {
            sb.append(" page=").append(page);
        }
        if (user != null && !user.isBlank() && !"anonymousUser".equals(user)) {
            sb.append(" user=").append(clean(user));
        }
        return sb.toString();
    }

    /** «GET /api/orders/15?q=…» → «GET /api/orders/{id}»; nomaʼlum metod — null. */
    static String apiName(String raw) {
        if (raw == null) {
            return null;
        }
        String s = raw.strip();
        int space = s.indexOf(' ');
        if (space <= 0) {
            return null;
        }
        String method = s.substring(0, space).toUpperCase(Locale.ROOT);
        String path = clean(s.substring(space + 1));
        return METHODS.contains(method) && path != null ? method + " " + path : null;
    }

    /** Yoʻl yoki nom: soʻrov satri va raqamli IDlar olib tashlanadi, boshqa belgilar «_» ga; boʻsh — null. */
    static String clean(String raw) {
        if (raw == null) {
            return null;
        }
        String s = raw.strip();
        int q = s.indexOf('?');
        if (q >= 0) {
            s = s.substring(0, q);
        }
        s = SAFE.matcher(NUMBER_SEGMENT.matcher(s).replaceAll("/{id}")).replaceAll("_");
        if (s.isEmpty()) {
            return null;
        }
        return s.length() > MAX_NAME ? s.substring(0, MAX_NAME) : s;
    }
}
