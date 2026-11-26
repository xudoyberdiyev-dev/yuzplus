package uz.yuzplus.identity.organization;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.HashMap;
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
import org.springframework.web.bind.annotation.RestController;
import uz.yuzplus.shared.audit.AuditEntry;
import uz.yuzplus.shared.audit.AuditLog;
import uz.yuzplus.shared.error.YuzplusException;
import uz.yuzplus.shared.pdf.PrintSettings;
import uz.yuzplus.shared.security.CurrentActor;

/**
 * BG1 F1 (egasi qarori 26.11.2026): filial direktori va bosh hisobchisi — xodimlardan, rolidan qatʼi nazar (masalan, ombor
 * menejeri). Hujjatlardagi ism {@link PrintSettings#signers(long)} dan: xodim → filial kartasidagi matn → rol boʻyicha.
 */
@RestController
@RequestMapping("/api/branches/{id}/signers")
@Tag(name = "branches", description = "Filiallar")
class BranchSignersController {

    record SignerEmployee(long id, String fullName, String roleCode, String roleName) {}

    record BranchSigners(@Schema(nullable = true) Long directorEmployeeId, @Schema(nullable = true) Long accountantEmployeeId,
            @Schema(nullable = true, description = "Hujjatlarga tushadigan rahbar (tanlangan / matn / rol boʻyicha)") String director,
            @Schema(nullable = true, description = "Hujjatlarga tushadigan bosh hisobchi") String accountant,
            @Schema(description = "Tanlash mumkin: shu filial yoki barcha filiallar faol xodimlari") List<SignerEmployee> options) {}

    record BranchSignersUpdate(@Schema(nullable = true, description = "null — tanlanmagan (matn yoki rol boʻyicha)") Long directorEmployeeId,
            @Schema(nullable = true, description = "null — tanlanmagan") Long accountantEmployeeId) {}

    private final JdbcClient jdbc;
    private final CurrentActor actor;
    private final AuditLog audit;
    private final PrintSettings print;

    BranchSignersController(JdbcClient jdbc, CurrentActor actor, AuditLog audit, PrintSettings print) {
        this.jdbc = jdbc;
        this.actor = actor;
        this.audit = audit;
        this.print = print;
    }

    private void scoped(long id) {
        boolean ok = actor.current().map(a -> a.canAccessBranch(id)).orElse(false)
                && jdbc.sql("SELECT EXISTS (SELECT 1 FROM branch WHERE id = :b)").param("b", id).query(Boolean.class).single();
        if (!ok) {
            throw YuzplusException.notFound("error.notFound");
        }
    }

    @GetMapping
    @PreAuthorize("hasAuthority('branches.view')")
    @Transactional(readOnly = true)
    @Operation(summary = "Filial direktori va bosh hisobchisi (xodimlardan)")
    BranchSigners branchSigners(@PathVariable long id) {
        scoped(id);
        record Ids(Long director, Long accountant) {}
        Ids ids = jdbc.sql("SELECT director_employee_id, accountant_employee_id FROM branch WHERE id = :b").param("b", id)
                .query((rs, n) -> new Ids(rs.getObject(1, Long.class), rs.getObject(2, Long.class)))
                .single();
        List<SignerEmployee> options = jdbc.sql("""
                SELECT e.id, e.full_name, r.code, r.name FROM employee e JOIN role r ON r.id = e.role_id
                WHERE (e.status = 'ACTIVE' AND (e.branch_id IS NULL OR e.branch_id = :b OR e.all_branches OR r.scope = 'all')) OR e.id IN (:sel)
                ORDER BY e.full_name""")
                .param("b", id)
                .param("sel", java.util.stream.Stream.of(ids.director(), ids.accountant(), -1L).filter(java.util.Objects::nonNull).toList())
                .query((rs, n) -> new SignerEmployee(rs.getLong(1), rs.getString(2), rs.getString(3), rs.getString(4)))
                .list();
        PrintSettings.Signers s = print.signers(id);
        return new BranchSigners(ids.director(), ids.accountant(), s.head(), s.accountant(), options);
    }

    @PutMapping
    @PreAuthorize("hasAuthority('branches.view')")
    @Transactional
    @Operation(summary = "Filial direktori va bosh hisobchisini tanlash",
            description = "Rolidan qatʼi nazar: shu filial yoki barcha filiallar faol xodimi. null — tanlanmagan.")
    BranchSigners updateBranchSigners(@PathVariable long id, @RequestBody BranchSignersUpdate r) {
        scoped(id);
        check(r.directorEmployeeId(), id);
        check(r.accountantEmployeeId(), id);
        Map<String, Object> before = new HashMap<>();
        jdbc.sql("SELECT director_employee_id, accountant_employee_id FROM branch WHERE id = :b FOR UPDATE").param("b", id)
                .query((rs, n) -> {
                    before.put("directorEmployeeId", rs.getObject(1, Long.class));
                    before.put("accountantEmployeeId", rs.getObject(2, Long.class));
                    return 1;
                })
                .single();
        jdbc.sql("UPDATE branch SET director_employee_id = :d, accountant_employee_id = :a WHERE id = :b")
                .param("d", r.directorEmployeeId()).param("a", r.accountantEmployeeId()).param("b", id).update();
        Map<String, Object> after = new HashMap<>();
        after.put("directorEmployeeId", r.directorEmployeeId());
        after.put("accountantEmployeeId", r.accountantEmployeeId());
        audit.record(AuditEntry.of("branch.signers", "branch", id).change(before, after));
        return branchSigners(id);
    }

    private void check(Long employeeId, long branchId) {
        if (employeeId == null) {
            return;
        }
        boolean ok = jdbc.sql("""
                SELECT EXISTS (SELECT 1 FROM employee e JOIN role r ON r.id = e.role_id WHERE e.id = :e AND e.status = 'ACTIVE'
                               AND (e.branch_id IS NULL OR e.branch_id = :b OR e.all_branches OR r.scope = 'all'))""")
                .param("e", employeeId).param("b", branchId).query(Boolean.class).single();
        if (!ok) {
            throw YuzplusException.badRequest("settings.signerInvalid");
        }
    }
}
