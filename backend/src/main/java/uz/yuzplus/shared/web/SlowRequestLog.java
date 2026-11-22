package uz.yuzplus.shared.web;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.annotation.Order;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.servlet.HandlerMapping;

/**
 * S1 production kuzatuvi: chegaradan ({@code yuzplus.slow-request-ms}, standart 1 000 ms) uzoq davom etgan API so'rovlarini
 * WARN darajasida loglaydi — Railway loglarida qaysi sahifa sekinlashganini ko'rish uchun. So'rov satri (qidiruv matni)
 * yozilmaydi; asinxron (SSE oqimi) so'rovlar o'tkaziladi. Spring Security zanjiridan keyin ishlaydi (foydalanuvchi logini uchun).
 */
@Component
@Order(0)
public class SlowRequestLog extends OncePerRequestFilter {

    private static final Logger LOG = LoggerFactory.getLogger(SlowRequestLog.class);

    private final long thresholdMs;

    public SlowRequestLog(@Value("${yuzplus.slow-request-ms:1000}") long thresholdMs) {
        this.thresholdMs = thresholdMs;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return thresholdMs <= 0 || !request.getRequestURI().startsWith("/api/");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        long start = System.nanoTime();
        try {
            chain.doFilter(request, response);
        } finally {
            long ms = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start);
            if (ms >= thresholdMs && !request.isAsyncStarted()) {
                Authentication auth = SecurityContextHolder.getContext().getAuthentication();
                Object pattern = request.getAttribute(HandlerMapping.BEST_MATCHING_PATTERN_ATTRIBUTE);
                LOG.warn(line(request.getMethod(), request.getRequestURI(), pattern == null ? null : pattern.toString(),
                        response.getStatus(), ms, auth == null || !auth.isAuthenticated() ? null : auth.getName()));
            }
        }
    }

    /** Log qatori: {@code slow-request GET /api/orders/{id} uri=/api/orders/15 status=200 ms=1530 user=operator1}. */
    static String line(String method, String uri, String pattern, int status, long ms, String user) {
        StringBuilder sb = new StringBuilder("slow-request ").append(method).append(' ').append(pattern == null ? uri : pattern);
        if (pattern != null && !pattern.equals(uri)) {
            sb.append(" uri=").append(uri);
        }
        sb.append(" status=").append(status).append(" ms=").append(ms);
        if (user != null && !user.isBlank() && !"anonymousUser".equals(user)) {
            sb.append(" user=").append(user);
        }
        return sb.toString();
    }
}
