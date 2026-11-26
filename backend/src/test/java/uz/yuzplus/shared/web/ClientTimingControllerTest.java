package uz.yuzplus.shared.web;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import uz.yuzplus.shared.web.ClientTimingController.TimingEntry;

/** TZ1: brauzer qaydlari logga xavfsiz tushadi — soʻrov satri, raqamli ID va begona belgilar yozilmaydi. */
class ClientTimingControllerTest {

    @Test
    void apiEntryIsNormalized() {
        assertThat(ClientTimingController.line(new TimingEntry("api", "get /api/orders/15/lines?q=aspirin", 2310, 200, "/orders/15"), "operator1"))
                .isEqualTo("slow-client api GET /api/orders/{id}/lines ms=2310 status=200 page=/orders/{id} user=operator1");
    }

    @Test
    void vitalEntryWithoutUser() {
        assertThat(ClientTimingController.line(new TimingEntry("vital", "LCP", 3100, null, "/home"), null)).isEqualTo("slow-client vital LCP ms=3100 page=/home");
        assertThat(ClientTimingController.line(new TimingEntry("vital", "INP", 400, null, null), "anonymousUser")).isEqualTo("slow-client vital INP ms=400");
    }

    @Test
    void invalidEntriesAreDropped() {
        assertThat(ClientTimingController.line(new TimingEntry("api", "HACK /x", 1, null, null), null)).isNull();
        assertThat(ClientTimingController.line(new TimingEntry("api", "/api/x", 1, null, null), null)).isNull();
        assertThat(ClientTimingController.line(new TimingEntry("other", "LCP", 1, null, null), null)).isNull();
        assertThat(ClientTimingController.line(new TimingEntry("vital", "INP", -1, null, null), null)).isNull();
        assertThat(ClientTimingController.line(new TimingEntry("vital", "INP", 700_000, null, null), null)).isNull();
        assertThat(ClientTimingController.line(new TimingEntry("vital", "  ", 1, null, null), null)).isNull();
        assertThat(ClientTimingController.line(null, null)).isNull();
    }

    @Test
    void unsafeCharactersAreReplacedAndLengthIsCapped() {
        assertThat(ClientTimingController.line(new TimingEntry("vital", "LCP\n<script>", 1, 99_999, "/a b"), null))
                .isEqualTo("slow-client vital LCP__script_ ms=1 page=/a_b");
        assertThat(ClientTimingController.clean("x".repeat(300))).hasSize(120);
    }
}
