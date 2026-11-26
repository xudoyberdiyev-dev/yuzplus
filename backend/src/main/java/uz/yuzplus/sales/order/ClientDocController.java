package uz.yuzplus.sales.order;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import uz.yuzplus.shared.error.YuzplusException;
import uz.yuzplus.shared.security.Actor;
import uz.yuzplus.shared.security.CurrentActor;

/** FT6: mijoz hujjatlari toʻplami (hisob varaq-faktura, tijorat taklifi, spetsifikatsiya) — kirim narxi bilan, alohida ruxsat. */
@RestController
@Tag(name = "client-docs", description = "Mijoz hujjatlari: hisob varaq-faktura, tijorat taklifi, spetsifikatsiya (FT6)")
class ClientDocController {

    private static final String CAN = "hasAuthority('orders.view') and hasAuthority('prices.view') and hasAuthority('invoices.costPrint')";

    private final ClientDocs docs;
    private final CurrentActor currentActor;

    ClientDocController(ClientDocs docs, CurrentActor currentActor) {
        this.docs = docs;
        this.currentActor = currentActor;
    }

    private Actor actor() {
        return currentActor.current().orElseThrow(() -> YuzplusException.unauthorized("auth.unauthorized"));
    }

    @GetMapping("/api/orders/{id}/client-docs")
    @PreAuthorize(CAN)
    @Operation(summary = "Hujjatlar oynasi: shartnoma, mijoz shartnomalari, bo'sh rekvizitlar")
    ClientDocs.ClientDocsInfo info(@PathVariable long id) {
        return docs.info(actor(), id);
    }

    @PutMapping("/api/orders/{id}/client-docs/contract")
    @PreAuthorize(CAN)
    @Operation(summary = "Buyurtma uchun mijoz shartnomasini tanlash", description = "Hujjat raqami va sanasi shu shartnomadan; buyurtma o'zgarmaydi.")
    ClientDocs.ClientDocsInfo contract(@PathVariable long id, @Valid @RequestBody ClientDocs.ContractRequest r) {
        return docs.setContract(actor(), id, r.contractId());
    }

    @GetMapping("/api/orders/{id}/client-docs/{kind}/xlsx")
    @PreAuthorize(CAN)
    @Operation(summary = "Bitta hujjat .xlsx", description = "INVOICE — hisob varaq-faktura, OFFER — tijorat taklifi, SPECIFICATION — spetsifikatsiya. "
            + "Shartnoma tanlanmagan bo'lsa — 400 clientDocs.contractRequired.")
    ResponseEntity<byte[]> xlsx(@PathVariable long id, @PathVariable ClientDocs.Kind kind) {
        ClientDocs.Doc d = docs.doc(actor(), id);
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_TYPE, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + docs.fileName(d, kind) + "\"")
                .body(docs.xlsx(d, kind));
    }

    @GetMapping("/api/orders/{id}/client-docs/zip")
    @PreAuthorize(CAN)
    @Operation(summary = "Uchala hujjat bitta arxivda (.zip)")
    ResponseEntity<byte[]> zip(@PathVariable long id) {
        ClientDocs.Doc d = docs.doc(actor(), id);
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_TYPE, "application/zip")
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + docs.zipName(d) + "\"")
                .body(docs.zip(d));
    }
}
