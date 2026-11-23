package uz.yuzplus.finance.cash;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import uz.yuzplus.shared.error.YuzplusException;
import uz.yuzplus.shared.security.Actor;
import uz.yuzplus.shared.security.CurrentActor;

/**
 * Xodim kamomadlari (KT1): ro'yxat — shortage.view; «Qaytardi» (kassa kirimi) — cash.io; «Hisobdan chiqarish» — shortage.writeOff (Direktor).
 */
@RestController
@Tag(name = "shortages", description = "Xodim (haydovchi) kamomadlari: qoldiq, jurnal, qaytarish, hisobdan chiqarish")
class ShortageController {

    record ShortageRepayRequest(@NotNull(message = "{validation.required}") Long branchId, @NotNull(message = "{validation.required}") Long employeeId,
            @NotNull(message = "{validation.required}") Long accountId,
            @NotBlank(message = "{validation.required}") @Size(max = 24) @Schema(description = "Summa, masalan «200000.00»") String amount,
            @Schema(nullable = true) @Size(max = 300) String note) {}

    record ShortageWriteOffRequest(@NotNull(message = "{validation.required}") Long branchId, @NotNull(message = "{validation.required}") Long employeeId,
            @NotBlank(message = "{validation.required}") @Size(max = 24) String amount,
            @NotBlank(message = "{validation.required}") @Size(max = 300) String reason) {}

    record ShortageRepayResult(String cashOp) {}

    private final Shortages shortages;
    private final CurrentActor currentActor;

    ShortageController(Shortages shortages, CurrentActor currentActor) {
        this.shortages = shortages;
        this.currentActor = currentActor;
    }

    private Actor actor() {
        return currentActor.current().orElseThrow(() -> YuzplusException.unauthorized("auth.unauthorized"));
    }

    @GetMapping("/api/shortages")
    @PreAuthorize("hasAuthority('shortage.view')")
    @Operation(summary = "Xodim kamomadlari", description = "Qoldiqlar (ochiq / hammasi) va jurnal (oxirgi 300 ta).")
    Shortages.ShortageOverview list(@RequestParam(required = false) Long branchId, @RequestParam(required = false) Long employeeId,
            @RequestParam(defaultValue = "false") boolean openOnly) {
        return shortages.overview(actor(), branchId, employeeId, openOnly);
    }

    @PostMapping("/api/shortages/repay")
    @PreAuthorize("hasAuthority('cash.io')")
    @Operation(summary = "Kamomadni qaytardi", description = "Kassa kirimi (KO, «Haydovchi kamomadini qaytardi»), kamomad qoldig'i kamayadi.")
    ShortageRepayResult repay(@Valid @RequestBody ShortageRepayRequest r) {
        return new ShortageRepayResult(shortages.repay(actor(), r.branchId(), r.employeeId(), r.accountId(), CashOps.parseAmount(r.amount(), "payment.amountInvalid"),
                r.note()));
    }

    @PostMapping("/api/shortages/write-off")
    @PreAuthorize("hasAuthority('shortage.writeOff')")
    @Operation(summary = "Kamomadni hisobdan chiqarish", description = "Sabab majburiy; kassa harakati yo'q.")
    void writeOff(@Valid @RequestBody ShortageWriteOffRequest r) {
        shortages.writeOff(actor(), r.branchId(), r.employeeId(), CashOps.parseAmount(r.amount(), "payment.amountInvalid"), r.reason());
    }
}
