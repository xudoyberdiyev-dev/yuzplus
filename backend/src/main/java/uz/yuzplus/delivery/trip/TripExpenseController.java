package uz.yuzplus.delivery.trip;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.UUID;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import uz.yuzplus.delivery.trip.TripExpenses.ExpenseReport;
import uz.yuzplus.delivery.trip.TripExpenses.TripMoneyView;
import uz.yuzplus.finance.TripMoney;
import uz.yuzplus.shared.error.YuzplusException;
import uz.yuzplus.shared.money.Money;
import uz.yuzplus.shared.security.Actor;
import uz.yuzplus.shared.security.Authorities;
import uz.yuzplus.shared.security.CurrentActor;

/**
 * Yo'l xarajatlari va reys avansi (HD2, SPEC 5.4). Avans — kassir (payments.mt); xarajat — haydovchi (trip.driver, o'z reysi);
 * tasdiqlash — kassir naqd qabulida ({@code POST /api/trips/{id}/cash/accept}); sahifa va hisobot — tripExpenses.view.
 */
@RestController
@Tag(name = "trip-expenses", description = "Yoʻl xarajatlari va reys avansi")
class TripExpenseController {

    private static final String WIDE = "hasAnyAuthority('shipments.view', 'payments.mt', 'tripExpenses.view', 'trip.driver')";

    record AdvanceRequest(@NotNull(message = "{validation.required}") Long accountId,
            @NotNull(message = "{validation.required}") @Size(max = 24) @Schema(description = "Summa, masalan «300000.00»") String amount,
            @Schema(nullable = true) @Size(max = 300) String note) {}

    record ExpenseRequest(@NotNull(message = "{validation.required}") TripMoney.Kind kind,
            @NotNull(message = "{validation.required}") @Size(max = 24) String amount,
            @NotNull(message = "{validation.required}") TripExpenses.Source source,
            @Schema(nullable = true, description = "«Boshqa» turida majburiy") @Size(max = 300) String note,
            @Schema(nullable = true, description = "Yoqilgʻi: litr") @DecimalMin("0.01") @DecimalMax("10000") BigDecimal liters,
            @Schema(nullable = true, description = "Yoqilgʻi: 1 litr narxi") @Size(max = 24) String price,
            @Schema(nullable = true, description = "Spidometr, km") @Min(0) @jakarta.validation.constraints.Max(9_999_999) Integer odometer,
            @Schema(nullable = true) @DecimalMin("-90") @DecimalMax("90") BigDecimal lat,
            @Schema(nullable = true) @DecimalMin("-180") @DecimalMax("180") BigDecimal lng,
            @Schema(nullable = true, description = "Qurilma vaqti (oflayn navbat)") Instant spentAt,
            @Schema(nullable = true, description = "Takroriy yuborishdan himoya (oflayn navbat)") UUID clientUuid) {}

    record ExpenseCreated(long id) {}

    record PhotoResult(long id) {}

    private final TripExpenses expenses;
    private final CurrentActor currentActor;

    TripExpenseController(TripExpenses expenses, CurrentActor currentActor) {
        this.expenses = expenses;
        this.currentActor = currentActor;
    }

    private Actor actor() {
        return currentActor.current().orElseThrow(() -> YuzplusException.unauthorized("auth.unauthorized"));
    }

    /** Kassir/rahbar — filialdagi har reys; faqat haydovchi — o'z reysi. */
    private static boolean wide() {
        return Authorities.has("shipments.view") || Authorities.has("payments.mt") || Authorities.has("tripExpenses.view");
    }

    @PostMapping("/api/trips/{id}/advances")
    @PreAuthorize("hasAuthority('payments.mt')")
    @Operation(summary = "Haydovchiga avans berish", description = "KO chiqim «Haydovchiga avans» (xarajat hisobotiga kirmaydi). Naqd qabulida qaytadi.")
    TripMoneyView advance(@PathVariable long id, @Valid @RequestBody AdvanceRequest r) {
        return expenses.issueAdvance(actor(), id, r.accountId(), parseMoney(r.amount()), r.note());
    }

    @GetMapping("/api/trips/{id}/money")
    @PreAuthorize(WIDE)
    @Operation(summary = "Reys avansi va yoʻl xarajatlari")
    TripMoneyView money(@PathVariable long id) {
        return expenses.view(actor(), id, wide());
    }

    @GetMapping("/api/trips/cash/extras")
    @PreAuthorize("hasAuthority('payments.mt')")
    @Operation(summary = "Hisob-kitob kutayotgan avans/xarajatli reyslar", description = "Kassa → «Haydovchilardan naqd» uchun.")
    List<TripMoneyView> extras(@RequestParam(required = false) Long branchId) {
        return expenses.open(actor(), branchId);
    }

    @PostMapping("/api/trips/{id}/expenses")
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasAuthority('trip.driver')")
    @Operation(summary = "Yoʻl xarajatini yozish (haydovchi)", description = "Yoqilgʻida chek rasmi majburiy (keyin yuklanadi; rasmsiz tasdiqlanmaydi).")
    ExpenseCreated addExpense(@PathVariable long id, @Valid @RequestBody ExpenseRequest r) {
        return new ExpenseCreated(expenses.addExpense(actor(), id, new TripExpenses.NewExpense(r.kind(), parseMoney(r.amount()), r.source(), r.note(),
                r.liters(), r.price() == null || r.price().isBlank() ? null : parseMoney(r.price()), r.odometer(), r.lat(), r.lng(), r.spentAt(),
                r.clientUuid())));
    }

    @PostMapping(value = "/api/trips/{id}/expenses/{expenseId}/photo", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasAuthority('trip.driver')")
    @Operation(summary = "Chek rasmi", description = "JPEG/PNG/WEBP, ≤ 5 MB.")
    PhotoResult photo(@PathVariable long id, @PathVariable long expenseId, @RequestParam("file") MultipartFile file) throws java.io.IOException {
        return new PhotoResult(expenses.addPhoto(actor(), id, expenseId, file.getContentType(), file.getBytes()));
    }

    @GetMapping("/api/trip-expenses/{expenseId}/photo")
    @PreAuthorize(WIDE)
    @Operation(summary = "Chek rasmini koʻrish")
    ResponseEntity<byte[]> photoView(@PathVariable long expenseId) {
        TripExpenses.Photo p = expenses.photo(actor(), expenseId, wide());
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(p.contentType()))
                .cacheControl(CacheControl.noStore())
                .header("X-Content-Type-Options", "nosniff")
                .body(p.data());
    }

    @GetMapping("/api/trip-expenses")
    @PreAuthorize("hasAuthority('tripExpenses.view')")
    @Operation(summary = "Yoʻl xarajatlari: roʻyxat va hisobot", description = "Haydovchi / mashina / oy / tur boʻyicha; 1 km ga soʻm — odometr boʻyicha.")
    ExpenseReport report(@RequestParam(required = false) Long branchId,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
            @RequestParam(required = false) Long driverId, @RequestParam(required = false) Long vehicleId,
            @RequestParam(required = false) TripExpenses.Status status) {
        LocalDate today = LocalDate.now(ZoneId.of("Asia/Tashkent"));
        LocalDate t = to == null ? today : to;
        LocalDate f = from == null ? t.withDayOfMonth(1) : from;
        if (f.isAfter(t) || f.plusDays(400).isBefore(t)) {
            throw YuzplusException.badRequest("cash.periodInvalid");
        }
        return expenses.report(actor(), branchId, f, t, driverId, vehicleId, status);
    }

    private static Money parseMoney(String s) {
        try {
            return Money.of(s.strip().replace(" ", "").replace(',', '.'));
        } catch (NumberFormatException e) {
            throw YuzplusException.badRequest("trip.expenseAmountInvalid");
        }
    }
}
