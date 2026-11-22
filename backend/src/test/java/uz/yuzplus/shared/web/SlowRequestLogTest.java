package uz.yuzplus.shared.web;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

class SlowRequestLogTest {

    @Test
    void lineUsesPatternAndOmitsQueryAndAnonymous() {
        assertThat(SlowRequestLog.line("GET", "/api/orders/15", "/api/orders/{id}", 200, 1530, "operator1"))
                .isEqualTo("slow-request GET /api/orders/{id} uri=/api/orders/15 status=200 ms=1530 user=operator1");
        assertThat(SlowRequestLog.line("GET", "/api/orders", "/api/orders", 500, 2000, "anonymousUser"))
                .isEqualTo("slow-request GET /api/orders status=500 ms=2000");
        assertThat(SlowRequestLog.line("POST", "/api/x", null, 404, 1000, null))
                .isEqualTo("slow-request POST /api/x status=404 ms=1000");
    }

    @Test
    void filtersOnlyApiAndCanBeDisabled() throws Exception {
        SlowRequestLog on = new SlowRequestLog(1000);
        assertThat(on.shouldNotFilter(new MockHttpServletRequest("GET", "/api/orders"))).isFalse();
        assertThat(on.shouldNotFilter(new MockHttpServletRequest("GET", "/actuator/health"))).isTrue();
        assertThat(new SlowRequestLog(0).shouldNotFilter(new MockHttpServletRequest("GET", "/api/orders"))).isTrue();

        // Zanjir har doim chaqiriladi (log faqat kuzatuv)
        MockFilterChain chain = new MockFilterChain();
        new SlowRequestLog(1).doFilter(new MockHttpServletRequest("GET", "/api/orders"), new MockHttpServletResponse(), chain);
        assertThat(chain.getRequest()).isNotNull();
    }
}
