package uz.yuzplus.inventory;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import jakarta.servlet.http.Cookie;
import java.time.LocalDate;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ThreadLocalRandom;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.support.TransactionTemplate;
import uz.yuzplus.TestcontainersConfig;
import uz.yuzplus.inventory.StockLedger.DocRef;
import uz.yuzplus.inventory.StockLedger.Move;
import uz.yuzplus.shared.money.Money;

/** BG1 B1: qoldiqdagi partiya raqami/sanalarini tahrirlash — sabab majburiy, tarix, audit, ruxsat, filial doirasi, bazadagi himoya. */
@SpringBootTest
@AutoConfigureMockMvc
@Import(TestcontainersConfig.class)
class BatchEditIT {

    private static final String PASSWORD = "Sinov-parol-2026";

    @Autowired
    MockMvc mvc;

    @Autowired
    JdbcClient jdbc;

    @Autowired
    PasswordEncoder encoder;

    @Autowired
    Warehouses warehouses;

    @Autowired
    StockLedger ledger;

    @Autowired
    TransactionTemplate tx;

    private long branch() {
        jdbc.sql("INSERT INTO company (name) SELECT 'Shifo Dori' WHERE NOT EXISTS (SELECT 1 FROM company)").update();
        var rnd = ThreadLocalRandom.current();
        String code = "" + (char) ('A' + rnd.nextInt(26)) + (char) ('A' + rnd.nextInt(26)) + (char) ('A' + rnd.nextInt(26));
        return jdbc.sql("""
                INSERT INTO branch (company_id, code, name, legal_name, tin)
                SELECT id, :c, 'B1 sinov ' || :c, 'MChJ', :t FROM company ON CONFLICT DO NOTHING RETURNING id""")
                .param("c", code)
                .param("t", String.valueOf(700_000_000L + rnd.nextLong(99_999_999L)))
                .query(Long.class)
                .optional()
                .orElseGet(this::branch);
    }

    private long stocked(long branch, String name) {
        Warehouses.Warehouse w = tx.execute(s -> warehouses.create(branch, "B1 ombor " + UUID.randomUUID().toString().substring(0, 4), null, Set.of()));
        long zone = w.zones().stream().filter(z -> z.type() == ZoneType.MAIN).findFirst().orElseThrow().id();
        long p = jdbc.sql("""
                INSERT INTO product (code, name, unit_id, search_text) SELECT :c, :n, id, lower(:n) FROM unit ORDER BY id LIMIT 1 RETURNING id""")
                .param("c", String.valueOf(10_000_000 + ThreadLocalRandom.current().nextInt(89_999_999)))
                .param("n", name)
                .query(Long.class)
                .single();
        long b = tx.execute(s -> ledger.createBatch(p, "OLD-" + UUID.randomUUID().toString().substring(0, 6), LocalDate.of(2026, 1, 1),
                LocalDate.of(2028, 6, 1), Money.of("1000.00"), false, "BQ", null));
        tx.executeWithoutResult(s -> ledger.post(new DocRef("BQ", 1, "BQ-B1T-000001"), List.of(Move.in(zone, b, 7))));
        return b;
    }

    private Cookie loginAs(String role, Long branchId) throws Exception {
        String login = "be" + UUID.randomUUID().toString().substring(0, 8);
        jdbc.sql("""
                INSERT INTO employee (login, full_name, role_id, branch_id, password_hash, must_change_password)
                SELECT :login, 'Sinov', id, :b, :hash, false FROM role WHERE code = :role""")
                .param("login", login).param("b", branchId).param("hash", encoder.encode(PASSWORD)).param("role", role)
                .update();
        MvcResult r = mvc.perform(post("/api/auth/login").with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"login\":\"" + login + "\",\"password\":\"" + PASSWORD + "\"}"))
                .andExpect(status().isOk())
                .andReturn();
        for (String h : r.getResponse().getHeaders("Set-Cookie")) {
            if (h.startsWith("YUZPLUS_SESSION=")) {
                return new Cookie("YUZPLUS_SESSION", h.substring("YUZPLUS_SESSION=".length(), h.indexOf(';')));
            }
        }
        throw new AssertionError("sessiya yo'q");
    }

    private static String body(long branch, String number, String produced, String expiry, String reason) {
        return "{\"branchId\":" + branch + ",\"number\":\"" + number + "\",\"producedOn\":" + (produced == null ? "null" : "\"" + produced + "\"")
                + ",\"expiryDate\":\"" + expiry + "\",\"reason\":\"" + reason + "\"}";
    }

    @Test
    void warehouseManagerEditsBatchWithReasonAndHistory() throws Exception {
        long br = branch();
        long batch = stocked(br, "B1 Sinov Paratsetamol");
        Cookie wm = loginAs("WAREHOUSE_MANAGER", br);

        mvc.perform(get("/api/stock/batch-edit").param("branchId", String.valueOf(br)).param("q", "paratsetamol").cookie(wm))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[?(@.batchId == " + batch + ")].qty").value(7));

        // sabab majburiy
        mvc.perform(put("/api/stock/batch-edit/" + batch).with(csrf()).cookie(wm).contentType(MediaType.APPLICATION_JSON)
                        .content(body(br, "NEW-1", null, "2029-02-01", " ")))
                .andExpect(status().isBadRequest());
        // ishlab chiqarilgan sana muddatdan keyin — rad
        mvc.perform(put("/api/stock/batch-edit/" + batch).with(csrf()).cookie(wm).contentType(MediaType.APPLICATION_JSON)
                        .content(body(br, "NEW-1", "2030-01-01", "2029-02-01", "Qadoqdagi sana")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("batchEdit.producedAfterExpiry"));

        mvc.perform(put("/api/stock/batch-edit/" + batch).with(csrf()).cookie(wm).contentType(MediaType.APPLICATION_JSON)
                        .content(body(br, "NEW-1", "2026-02-01", "2029-02-01", "Qadoqdagi raqam boshqacha")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.number").value("NEW-1"))
                .andExpect(jsonPath("$.expiryDate").value("2029-02-01"))
                .andExpect(jsonPath("$.qty").value(7))
                .andExpect(jsonPath("$.edits").value(1));
        assertThat(jdbc.sql("SELECT number || '|' || expiry_date || '|' || cost FROM batch WHERE id = :b").param("b", batch).query(String.class).single())
                .isEqualTo("NEW-1|2029-02-01|1000.00");
        mvc.perform(get("/api/stock/batch-edit/" + batch + "/history").param("branchId", String.valueOf(br)).cookie(wm))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].newNumber").value("NEW-1"))
                .andExpect(jsonPath("$[0].oldExpiry").value("2028-06-01"))
                .andExpect(jsonPath("$[0].reason").value("Qadoqdagi raqam boshqacha"));
        assertThat(jdbc.sql("SELECT count(*) FROM audit_log WHERE action = 'batch.edit' AND entity_id = :b").param("b", String.valueOf(batch))
                .query(Long.class).single()).isEqualTo(1);
        // oʻzgarishsiz — rad
        mvc.perform(put("/api/stock/batch-edit/" + batch).with(csrf()).cookie(wm).contentType(MediaType.APPLICATION_JSON)
                        .content(body(br, "NEW-1", "2026-02-01", "2029-02-01", "Yana")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("batchEdit.nothingChanged"));
    }

    @Test
    void permissionsBranchScopeAndDatabaseGuard() throws Exception {
        long br = branch();
        long other = branch();
        long batch = stocked(br, "B1 Sinov Analgin");
        Cookie op = loginAs("OPERATOR", br);
        mvc.perform(put("/api/stock/batch-edit/" + batch).with(csrf()).cookie(op).contentType(MediaType.APPLICATION_JSON)
                        .content(body(br, "X", null, "2029-01-01", "Sabab")))
                .andExpect(status().isForbidden());
        Cookie foreign = loginAs("WAREHOUSE_MANAGER", other);
        mvc.perform(put("/api/stock/batch-edit/" + batch).with(csrf()).cookie(foreign).contentType(MediaType.APPLICATION_JSON)
                        .content(body(br, "X", null, "2029-01-01", "Sabab")))
                .andExpect(status().isNotFound());
        mvc.perform(put("/api/stock/batch-edit/" + batch).with(csrf()).cookie(foreign).contentType(MediaType.APPLICATION_JSON)
                        .content(body(other, "X", null, "2029-01-01", "Sabab")))
                .andExpect(status().isNotFound());
        // Baza: servissiz tahrirlash va boshqa maydonlar — taqiqlangan
        assertThatThrownBy(() -> jdbc.sql("UPDATE batch SET number = 'HACK' WHERE id = :b").param("b", batch).update())
                .hasMessageContaining("batch");
        assertThatThrownBy(() -> tx.executeWithoutResult(s -> {
            jdbc.sql("SELECT set_config('yuzplus.batch_edit', 'on', true)").query(String.class).single();
            jdbc.sql("UPDATE batch SET cost = 1 WHERE id = :b").param("b", batch).update();
        })).hasMessageContaining("batch");
        assertThatThrownBy(() -> jdbc.sql("DELETE FROM batch WHERE id = :b").param("b", batch).update()).hasMessageContaining("batch");
    }
}
