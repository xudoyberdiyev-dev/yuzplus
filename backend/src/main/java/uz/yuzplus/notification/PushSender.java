package uz.yuzplus.notification;

import jakarta.annotation.PreDestroy;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Collection;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * HD1: Expo push (mobil ilova). Bildirishnoma yozilgan tranzaksiya commit bo'lgach, fon oqimida xodimning faol qurilma tokenlariga
 * yuboriladi; xato hujjat o'tkazishni hech qachon to'xtatmaydi. «DeviceNotRegistered» — token o'chiriladi. Android uchun FCM kaliti
 * Expo loyihasiga yuklangan bo'lishi kerak (docs/mobil-apk.md); bo'lmasa push yetmaydi, ilova ichidagi bildirishnomalar ishlayveradi.
 */
@Service
public class PushSender {

    private static final Logger log = LoggerFactory.getLogger(PushSender.class);

    private final JdbcClient jdbc;
    private final boolean enabled;
    private final String url;
    private final ExecutorService sender = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "push-expo");
        t.setDaemon(true);
        return t;
    });

    PushSender(JdbcClient jdbc, @Value("${yuzplus.push.enabled:true}") boolean enabled,
            @Value("${yuzplus.push.expo-url:https://exp.host/--/api/v2/push/send}") String url) {
        this.jdbc = jdbc;
        this.enabled = enabled;
        this.url = url;
    }

    @PreDestroy
    void shutdown() {
        sender.shutdownNow();
    }

    /** Joriy tranzaksiya commit bo'lgach yuboradi (tranzaksiya bo'lmasa — darhol). */
    void afterCommit(Collection<Long> employees, String title, String body, String link) {
        if (!enabled || employees.isEmpty()) {
            return;
        }
        List<Long> ids = List.copyOf(employees);
        Runnable job = () -> {
            try {
                sender.execute(() -> send(ids, title, body, link));
            } catch (RuntimeException e) {
                log.debug("Push navbatga qo'yilmadi", e);
            }
        };
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    job.run();
                }
            });
        } else {
            job.run();
        }
    }

    private void send(List<Long> employees, String title, String body, String link) {
        try {
            List<String> tokens = jdbc.sql("SELECT token FROM device_token WHERE active AND employee_id IN (:ids) ORDER BY id")
                    .param("ids", employees)
                    .query(String.class)
                    .list();
            if (tokens.isEmpty()) {
                return;
            }
            String json = payload(tokens, title, body, link);
            HttpRequest request = HttpRequest.newBuilder(URI.create(url))
                    .timeout(Duration.ofSeconds(15))
                    .header("Content-Type", "application/json")
                    .header("Accept", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(json))
                    .build();
            try (HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build()) {
                HttpResponse<String> r = client.send(request, HttpResponse.BodyHandlers.ofString());
                if (r.statusCode() / 100 != 2) {
                    log.warn("Expo push javobi {}", r.statusCode());
                    return;
                }
                deactivateUnregistered(tokens, r.body());
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } catch (Exception e) {
            log.warn("Expo push yuborilmadi: {}", e.toString());
        }
    }

    /** Javob «data» massivi tokenlar tartibida; «DeviceNotRegistered» bo'lgan token o'chiriladi. */
    private void deactivateUnregistered(List<String> tokens, String response) {
        String[] tickets = response.split("\\{\"status\"");
        for (int i = 1; i < tickets.length && i <= tokens.size(); i++) {
            if (tickets[i].contains("DeviceNotRegistered")) {
                jdbc.sql("UPDATE device_token SET active = false WHERE token = :t").param("t", tokens.get(i - 1)).update();
            }
        }
    }

    static String payload(List<String> tokens, String title, String body, String link) {
        StringBuilder b = new StringBuilder("[");
        for (int i = 0; i < tokens.size(); i++) {
            if (i > 0) {
                b.append(',');
            }
            b.append("{\"to\":").append(quote(tokens.get(i))).append(",\"title\":").append(quote(title));
            if (body != null) {
                b.append(",\"body\":").append(quote(body));
            }
            b.append(",\"sound\":\"default\",\"priority\":\"high\",\"channelId\":\"default\",\"data\":{\"link\":")
                    .append(link == null ? "null" : quote(link)).append("}}");
        }
        return b.append(']').toString();
    }

    static String quote(String s) {
        StringBuilder b = new StringBuilder("\"");
        for (char c : s.toCharArray()) {
            switch (c) {
                case '"' -> b.append("\\\"");
                case '\\' -> b.append("\\\\");
                case '\n' -> b.append("\\n");
                case '\r' -> b.append("\\r");
                case '\t' -> b.append("\\t");
                default -> {
                    if (c < 0x20) {
                        b.append(String.format("\\u%04x", (int) c));
                    } else {
                        b.append(c);
                    }
                }
            }
        }
        return b.append('"').toString();
    }
}
