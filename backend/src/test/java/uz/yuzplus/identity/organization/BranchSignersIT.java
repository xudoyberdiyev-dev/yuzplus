package uz.yuzplus.identity.organization;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import jakarta.servlet.http.Cookie;
import java.util.UUID;
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
import uz.yuzplus.TestcontainersConfig;
import uz.yuzplus.shared.pdf.PrintSettings;

/** BG1 F1: filial direktori / bosh hisobchisi xodimlardan (rolidan qatʼi nazar) → hujjatlarga; tanlanmasa — matn zaxirasi. */
@SpringBootTest
@AutoConfigureMockMvc
@Import(TestcontainersConfig.class)
class BranchSignersIT {

    private static final String PASSWORD = "Sinov-parol-2026";

    @Autowired
    MockMvc mvc;

    @Autowired
    JdbcClient jdbc;

    @Autowired
    PasswordEncoder encoder;

    @Autowired
    PrintSettings print;

    private Cookie loginAs(String role) throws Exception {
        String login = "bsg" + UUID.randomUUID().toString().substring(0, 8);
        jdbc.sql("""
                INSERT INTO employee (login, full_name, role_id, password_hash, must_change_password)
                SELECT :login, 'Sinov', id, :hash, false FROM role WHERE code = :role""")
                .param("login", login)
                .param("hash", encoder.encode(PASSWORD))
                .param("role", role)
                .update();
        MvcResult r = mvc.perform(post("/api/auth/login")
                        .with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
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

    private long employee(String role, String name, Long branch) {
        return jdbc.sql("""
                INSERT INTO employee (login, full_name, role_id, password_hash, must_change_password, branch_id)
                SELECT :l, :n, id, 'x', false, :b FROM role WHERE code = :r RETURNING id""")
                .param("l", "bs" + UUID.randomUUID().toString().substring(0, 8)).param("n", name).param("b", branch).param("r", role)
                .query(Long.class).single();
    }

    @Test
    void anyRoleEmployeeBecomesSignerOnDocuments() throws Exception {
        Cookie dir = loginAs("DIRECTOR");
        long branch = jdbc.sql("SELECT id FROM branch WHERE active ORDER BY id LIMIT 1").query(Long.class).single();
        jdbc.sql("INSERT INTO company (name) SELECT 'Shifo Dori' WHERE NOT EXISTS (SELECT 1 FROM company)").update();
        var rnd = java.util.concurrent.ThreadLocalRandom.current();
        String code = "" + (char) ('A' + rnd.nextInt(26)) + (char) ('A' + rnd.nextInt(26)) + (char) ('A' + rnd.nextInt(26)) + (char) ('A' + rnd.nextInt(26));
        long other = jdbc.sql("""
                INSERT INTO branch (company_id, code, name, legal_name, tin)
                SELECT id, :c, 'Sinov F1 ' || :c, 'Sinov MChJ', :t FROM company ORDER BY id LIMIT 1 RETURNING id""")
                .param("c", code)
                .param("t", String.valueOf(500_000_000L + rnd.nextLong(99_999_999L)))
                .query(Long.class).single();
        long wh = employee("WAREHOUSE_MANAGER", "Omborchi Direktorov", branch);
        long picker = employee("PICKER", "Yigʻuvchi Hisobchiyev", null);
        long foreign = employee("OPERATOR", "Begona Filial", other);
        jdbc.sql("UPDATE branch SET director_name = 'Matn Direktor', accountant_name = 'Matn Hisobchi' WHERE id = :b").param("b", branch).update();
        try {
            // tanlanmagan — matn zaxirasi
            mvc.perform(get("/api/branches/" + branch + "/signers").cookie(dir))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.director").value("Matn Direktor"))
                    .andExpect(jsonPath("$.options[?(@.id == " + wh + ")].roleCode").value("WAREHOUSE_MANAGER"));
            // boshqa filial xodimi — rad
            mvc.perform(put("/api/branches/" + branch + "/signers").with(csrf()).cookie(dir).contentType(MediaType.APPLICATION_JSON)
                            .content("{\"directorEmployeeId\":" + foreign + ",\"accountantEmployeeId\":null}"))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("settings.signerInvalid"));
            // ombor menejeri — direktor, yigʻuvchi (barcha filiallar) — bosh hisobchi
            mvc.perform(put("/api/branches/" + branch + "/signers").with(csrf()).cookie(dir).contentType(MediaType.APPLICATION_JSON)
                            .content("{\"directorEmployeeId\":" + wh + ",\"accountantEmployeeId\":" + picker + "}"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.directorEmployeeId").value((int) wh))
                    .andExpect(jsonPath("$.director").value("Omborchi Direktorov"))
                    .andExpect(jsonPath("$.accountant").value("Yigʻuvchi Hisobchiyev"));
            PrintSettings.Signers s = print.signers(branch);
            assertThat(s.head()).isEqualTo("Omborchi Direktorov");
            assertThat(s.accountant()).isEqualTo("Yigʻuvchi Hisobchiyev");
            assertThat(jdbc.sql("SELECT count(*) FROM audit_log WHERE action = 'branch.signers' AND entity_id = :b")
                    .param("b", String.valueOf(branch)).query(Long.class).single()).isPositive();
            // tanlov olib tashlansa — yana matn
            mvc.perform(put("/api/branches/" + branch + "/signers").with(csrf()).cookie(dir).contentType(MediaType.APPLICATION_JSON)
                            .content("{\"directorEmployeeId\":null,\"accountantEmployeeId\":null}"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.accountant").value("Matn Hisobchi"));
        } finally {
            jdbc.sql("""
                    UPDATE branch SET director_employee_id = NULL, accountant_employee_id = NULL, director_name = NULL, accountant_name = NULL
                    WHERE id = :b""").param("b", branch).update();
        }
    }

    @Test
    void operatorCannotChangeSigners() throws Exception {
        Cookie op = loginAs("OPERATOR");
        long branch = jdbc.sql("SELECT id FROM branch WHERE active ORDER BY id LIMIT 1").query(Long.class).single();
        mvc.perform(put("/api/branches/" + branch + "/signers").with(csrf()).cookie(op).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"directorEmployeeId\":null,\"accountantEmployeeId\":null}"))
                .andExpect(status().isForbidden());
    }
}
