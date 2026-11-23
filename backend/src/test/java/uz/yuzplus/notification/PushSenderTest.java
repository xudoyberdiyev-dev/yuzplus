package uz.yuzplus.notification;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;

class PushSenderTest {

    @Test
    void payloadEscapesAndCarriesLink() {
        String json = PushSender.payload(List.of("ExponentPushToken[a]", "ExponentPushToken[b]"), "Yangi reys: \"RS-1\"", null, "/driver");
        assertThat(json).startsWith("[{\"to\":\"ExponentPushToken[a]\",\"title\":\"Yangi reys: \\\"RS-1\\\"\"")
                .contains("{\"to\":\"ExponentPushToken[b]\"")
                .contains("\"data\":{\"link\":\"/driver\"}")
                .doesNotContain("\"body\"")
                .endsWith("}]");
        assertThat(PushSender.payload(List.of("ExponentPushToken[a]"), "T", "B", null)).contains("\"body\":\"B\"", "\"link\":null");
        assertThat(PushSender.quote("a\nb\\")).isEqualTo("\"a\\nb\\\\\"");
    }
}
