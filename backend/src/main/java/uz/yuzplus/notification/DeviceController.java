package uz.yuzplus.notification;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import uz.yuzplus.shared.error.YuzplusException;
import uz.yuzplus.shared.security.CurrentActor;

/** HD1: mobil qurilma tokeni (Expo push). Kirgan har xodim o'z qurilmasini ro'yxatdan o'tkazadi; chiqishda — o'chiradi. */
@RestController
@Tag(name = "devices", description = "Mobil qurilma (push) tokenlari")
class DeviceController {

    enum Platform { ANDROID, IOS }

    record DeviceRequest(
            @NotBlank(message = "{validation.required}") @Size(max = 200)
            @Pattern(regexp = "^Expo(nent)?PushToken\\[[A-Za-z0-9_\\-]+\\]$", message = "{device.tokenInvalid}")
            @Schema(description = "ExponentPushToken[…]") String token,
            @NotNull(message = "{validation.required}") Platform platform) {}

    record DeviceRemoveRequest(@NotBlank(message = "{validation.required}") @Size(max = 200) String token) {}

    private final JdbcClient jdbc;
    private final CurrentActor currentActor;

    DeviceController(JdbcClient jdbc, CurrentActor currentActor) {
        this.jdbc = jdbc;
        this.currentActor = currentActor;
    }

    private long me() {
        return currentActor.current().orElseThrow(() -> YuzplusException.unauthorized("auth.unauthorized")).employeeId();
    }

    @PostMapping("/api/devices")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @PreAuthorize("isAuthenticated()")
    @Operation(summary = "Qurilma tokenini ro'yxatdan o'tkazish", description = "Token boshqa xodimda bo'lsa — joriy xodimga o'tadi.")
    @Transactional
    void register(@Valid @RequestBody DeviceRequest r) {
        jdbc.sql("""
                INSERT INTO device_token (employee_id, token, platform) VALUES (:e, :t, :p)
                ON CONFLICT (token) DO UPDATE SET employee_id = :e, platform = :p, active = true, last_seen_at = now()""")
                .param("e", me()).param("t", r.token()).param("p", r.platform().name())
                .update();
    }

    @PostMapping("/api/devices/remove")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @PreAuthorize("isAuthenticated()")
    @Operation(summary = "Qurilma tokenini o'chirish (chiqishda)")
    @Transactional
    void remove(@Valid @RequestBody DeviceRemoveRequest r) {
        jdbc.sql("UPDATE device_token SET active = false WHERE token = :t AND employee_id = :e").param("t", r.token()).param("e", me()).update();
    }
}
