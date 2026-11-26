package uz.yuzplus.inventory;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.time.LocalDate;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import uz.yuzplus.shared.audit.AuditEntry;
import uz.yuzplus.shared.audit.AuditLog;
import uz.yuzplus.shared.error.YuzplusException;
import uz.yuzplus.shared.security.Actor;
import uz.yuzplus.shared.security.CurrentActor;
import uz.yuzplus.shared.text.SearchText;

/**
 * BG1 B1 (egasi 26.11.2026): qoldiqdagi partiyalar — raqam, ishlab chiqarilgan sana va yaroqlilik muddatini tahrirlash
 * (alohida sahifa). Sabab majburiy, tarix ({@code batch_edit}) va audit; oʻtkazilgan hujjatlar oʻz nusxasini saqlaydi.
 * Bazada: faqat shu uch maydon va faqat shu servis orqali (V122 trigger, sessiya belgisi {@code yuzplus.batch_edit}).
 */
@RestController
@RequestMapping("/api/stock/batch-edit")
@Tag(name = "stock", description = "Qoldiqlar")
class BatchEditController {

    private static final int LIMIT = 500;

    record EditableBatch(long batchId, long productId, String productCode, String productName, String number,
            @Schema(nullable = true) LocalDate producedOn, LocalDate expiryDate, long qty, int edits) {}

    record EditableBatches(List<EditableBatch> items, @Schema(description = "Roʻyxat cheklangan (qidiruvni aniqlashtiring)") boolean truncated) {}

    record BatchEditRequest(@NotNull Long branchId,
            @NotBlank(message = "{validation.required}") @Size(max = 64) String number,
            @Schema(nullable = true) LocalDate producedOn,
            @NotNull(message = "{validation.required}") LocalDate expiryDate,
            @NotBlank(message = "{validation.required}") @Size(max = 300) String reason) {}

    record BatchEditRow(Instant at, @Schema(nullable = true) String employee, String oldNumber, String newNumber,
            @Schema(nullable = true) LocalDate oldProduced, @Schema(nullable = true) LocalDate newProduced, LocalDate oldExpiry,
            LocalDate newExpiry, String reason) {}

    private final JdbcClient jdbc;
    private final CurrentActor currentActor;
    private final AuditLog audit;

    BatchEditController(JdbcClient jdbc, CurrentActor currentActor, AuditLog audit) {
        this.jdbc = jdbc;
        this.currentActor = currentActor;
        this.audit = audit;
    }

    private Actor actor(long branchId) {
        Actor a = currentActor.current().orElseThrow(() -> YuzplusException.unauthorized("auth.unauthorized"));
        if (!a.canAccessBranch(branchId)) {
            throw YuzplusException.notFound("error.notFound");
        }
        return a;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('stock.batchEdit')")
    @Transactional(readOnly = true)
    @Operation(summary = "Qoldiqdagi partiyalar (tahrirlash uchun)", description = "Filial omborlarida qoldigʻi bor partiyalar; muddati yaqinlari birinchi.")
    EditableBatches batchEditList(@RequestParam long branchId, @RequestParam(required = false) String q) {
        actor(branchId);
        StringBuilder where = new StringBuilder();
        Map<String, Object> params = new HashMap<>();
        params.put("b", branchId);
        String nq = SearchText.normalize(q);
        if (!nq.isEmpty()) {
            String[] parts = nq.split(" ");
            where.append(" AND (p.code = :exact OR b.number ILIKE :num ESCAPE '\\' OR (true");
            for (int i = 0; i < parts.length && i < 8; i++) {
                where.append(" AND p.search_text LIKE :w").append(i).append(" ESCAPE '\\'");
                params.put("w" + i, "%" + SearchText.likeEscape(parts[i]) + "%");
            }
            where.append("))");
            params.put("exact", q.strip());
            params.put("num", "%" + SearchText.likeEscape(q.strip()) + "%");
        }
        List<EditableBatch> rows = jdbc.sql("""
                SELECT b.id, p.id AS product_id, p.code, p.name, b.number, b.produced_on, b.expiry_date, s.qty,
                       (SELECT count(*) FROM batch_edit e WHERE e.batch_id = b.id)::int AS edits
                FROM (SELECT batch_id, sum(qty) AS qty FROM stock_balance WHERE branch_id = :b AND qty > 0 GROUP BY batch_id) s
                JOIN batch b ON b.id = s.batch_id JOIN product p ON p.id = b.product_id
                WHERE true""" + where + " ORDER BY b.expiry_date, p.name, b.number LIMIT " + (LIMIT + 1))
                .params(params)
                .query((rs, n) -> new EditableBatch(rs.getLong("id"), rs.getLong("product_id"), rs.getString("code"), rs.getString("name"),
                        rs.getString("number"), rs.getObject("produced_on", LocalDate.class), rs.getObject("expiry_date", LocalDate.class),
                        rs.getLong("qty"), rs.getInt("edits")))
                .list();
        boolean truncated = rows.size() > LIMIT;
        return new EditableBatches(truncated ? rows.subList(0, LIMIT) : rows, truncated);
    }

    @PutMapping("/{batchId}")
    @PreAuthorize("hasAuthority('stock.batchEdit')")
    @Transactional
    @Operation(summary = "Partiya raqami, ishlab chiqarilgan sana va yaroqlilik muddatini tahrirlash",
            description = "Sabab majburiy. Faqat filialda qoldigʻi bor partiya. Oʻtkazilgan hujjatlar oʻzgarmaydi.")
    EditableBatch batchEditSave(@PathVariable long batchId, @Valid @RequestBody BatchEditRequest r) {
        Actor a = actor(r.branchId());
        record Old(long productId, String number, LocalDate produced, LocalDate expiry) {}
        Old old = jdbc.sql("SELECT product_id, number, produced_on, expiry_date FROM batch WHERE id = :id FOR UPDATE")
                .param("id", batchId)
                .query((rs, n) -> new Old(rs.getLong(1), rs.getString(2), rs.getObject(3, LocalDate.class), rs.getObject(4, LocalDate.class)))
                .optional()
                .orElseThrow(() -> YuzplusException.notFound("error.notFound"));
        boolean inBranch = jdbc.sql("SELECT EXISTS (SELECT 1 FROM stock_balance WHERE batch_id = :id AND branch_id = :b AND qty > 0)")
                .param("id", batchId).param("b", r.branchId()).query(Boolean.class).single();
        if (!inBranch) {
            throw YuzplusException.notFound("error.notFound");
        }
        String number = r.number().strip();
        if (r.producedOn() != null && r.producedOn().isAfter(r.expiryDate())) {
            throw YuzplusException.badRequest("batchEdit.producedAfterExpiry");
        }
        if (number.equals(old.number()) && java.util.Objects.equals(r.producedOn(), old.produced()) && r.expiryDate().equals(old.expiry())) {
            throw YuzplusException.badRequest("batchEdit.nothingChanged");
        }
        jdbc.sql("SELECT set_config('yuzplus.batch_edit', 'on', true)").query(String.class).single();
        jdbc.sql("UPDATE batch SET number = :n, produced_on = :p, expiry_date = :e WHERE id = :id")
                .param("n", number).param("p", r.producedOn()).param("e", r.expiryDate()).param("id", batchId).update();
        jdbc.sql("SELECT set_config('yuzplus.batch_edit', 'off', true)").query(String.class).single();
        jdbc.sql("""
                INSERT INTO batch_edit (batch_id, branch_id, old_number, new_number, old_produced, new_produced, old_expiry, new_expiry, reason, employee_id)
                VALUES (:id, :b, :on, :nn, :op, :np, :oe, :ne, :r, :emp)""")
                .param("id", batchId).param("b", r.branchId()).param("on", old.number()).param("nn", number)
                .param("op", old.produced()).param("np", r.producedOn()).param("oe", old.expiry()).param("ne", r.expiryDate())
                .param("r", r.reason().strip()).param("emp", a.employeeId())
                .update();
        Map<String, Object> before = new LinkedHashMap<>();
        before.put("number", old.number());
        before.put("producedOn", old.produced());
        before.put("expiryDate", old.expiry());
        Map<String, Object> after = new LinkedHashMap<>();
        after.put("number", number);
        after.put("producedOn", r.producedOn());
        after.put("expiryDate", r.expiryDate());
        audit.record(AuditEntry.of("batch.edit", "batch", batchId).change(before, after).withReason(r.reason().strip()));
        return jdbc.sql("""
                SELECT b.id, p.id AS product_id, p.code, p.name, b.number, b.produced_on, b.expiry_date,
                       coalesce((SELECT sum(qty) FROM stock_balance WHERE batch_id = b.id AND branch_id = :b), 0) AS qty,
                       (SELECT count(*) FROM batch_edit e WHERE e.batch_id = b.id)::int AS edits
                FROM batch b JOIN product p ON p.id = b.product_id WHERE b.id = :id""")
                .param("id", batchId).param("b", r.branchId())
                .query((rs, n) -> new EditableBatch(rs.getLong("id"), rs.getLong("product_id"), rs.getString("code"), rs.getString("name"),
                        rs.getString("number"), rs.getObject("produced_on", LocalDate.class), rs.getObject("expiry_date", LocalDate.class),
                        rs.getLong("qty"), rs.getInt("edits")))
                .single();
    }

    @GetMapping("/{batchId}/history")
    @PreAuthorize("hasAuthority('stock.batchEdit')")
    @Transactional(readOnly = true)
    @Operation(summary = "Partiya tahrirlash tarixi")
    List<BatchEditRow> batchEditHistory(@PathVariable long batchId, @RequestParam long branchId) {
        actor(branchId);
        return jdbc.sql("""
                SELECT e.created_at, em.full_name, e.old_number, e.new_number, e.old_produced, e.new_produced, e.old_expiry, e.new_expiry, e.reason
                FROM batch_edit e LEFT JOIN employee em ON em.id = e.employee_id
                WHERE e.batch_id = :id AND EXISTS (SELECT 1 FROM stock_balance s WHERE s.batch_id = e.batch_id AND s.branch_id = :b)
                ORDER BY e.created_at DESC, e.id DESC""")
                .param("id", batchId).param("b", branchId)
                .query((rs, n) -> new BatchEditRow(rs.getTimestamp(1).toInstant(), rs.getString(2), rs.getString(3), rs.getString(4),
                        rs.getObject(5, LocalDate.class), rs.getObject(6, LocalDate.class), rs.getObject(7, LocalDate.class),
                        rs.getObject(8, LocalDate.class), rs.getString(9)))
                .list();
    }
}
