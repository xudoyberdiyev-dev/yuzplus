package uz.yuzplus.catalog.product;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import jakarta.servlet.http.Cookie;
import java.math.BigDecimal;
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
import uz.yuzplus.TestcontainersConfig;

/** BG1 N2: amaldagi QQS stavkasini barcha mahsulotlarga qoʻllash — ozodlar oʻzgarmaydi, eskirgan stavka 409, ruxsat, audit. */
@SpringBootTest
@AutoConfigureMockMvc
@Import(TestcontainersConfig.class)
class ProductVatBulkIT {

    private static final String PASSWORD = "Sinov-parol-2026";

    @Autowired
    MockMvc mvc;

    @Autowired
    JdbcClient jdbc;

    @Autowired
    PasswordEncoder encoder;

    private Cookie loginAs(String role) throws Exception {
        String login = "vbk" + UUID.randomUUID().toString().substring(0, 8);
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

    private long product(BigDecimal vat, boolean exempt) {
        String code = String.valueOf(ThreadLocalRandom.current().nextInt(90_000_000, 99_999_999));
        return jdbc.sql("""
                INSERT INTO product (unit_id, code, name, vat_rate, vat_exempt) SELECT id, :c, :n, :v, :e FROM unit ORDER BY id LIMIT 1
                RETURNING id""")
                .param("c", code)
                .param("n", "QQS sinov " + code)
                .param("v", vat)
                .param("e", exempt)
                .query(Long.class)
                .single();
    }

    private BigDecimal vatOf(long id) {
        return jdbc.sql("SELECT vat_rate FROM product WHERE id = :id").param("id", id).query(BigDecimal.class).single();
    }

    @Test
    void appliesCurrentRateExceptExempt() throws Exception {
        Cookie dir = loginAs("DIRECTOR");
        // boshqa test sinflarining mahsulotlariga taʼsir qilmasin — oxirida asl stavkalar qaytariladi
        java.util.Map<Long, BigDecimal> backup = new java.util.HashMap<>();
        jdbc.sql("SELECT id, vat_rate FROM product").query((rs, n) -> backup.put(rs.getLong("id"), rs.getBigDecimal("vat_rate"))).list();
        try {
            run(dir);
        } finally {
            backup.forEach((id, v) -> jdbc.sql("UPDATE product SET vat_rate = :v WHERE id = :id AND vat_rate <> :v")
                    .param("v", v).param("id", id).update());
        }
    }

    private void run(Cookie dir) throws Exception {
        String body = mvc.perform(get("/api/products/vat-bulk/preview").cookie(dir))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        java.util.regex.Matcher m = java.util.regex.Pattern.compile("\"rate\"\\s*:\\s*\"([0-9.]+)\"").matcher(body);
        assertThat(m.find()).as(body).isTrue();
        String rate = m.group(1);
        BigDecimal other = new BigDecimal(rate).compareTo(new BigDecimal("15")) == 0 ? new BigDecimal("10.00") : new BigDecimal("15.00");
        long a = product(other, false);
        long b = product(BigDecimal.ZERO, false);
        long exempt = product(BigDecimal.ZERO, true);
        long same = product(new BigDecimal(rate), false);
        long versionBefore = jdbc.sql("SELECT version FROM product WHERE id = :id").param("id", same).query(Long.class).single();

        mvc.perform(get("/api/products/vat-bulk/preview").cookie(dir))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.rate").value(rate))
                .andExpect(jsonPath("$.affected").isNumber());

        mvc.perform(post("/api/products/vat-bulk").with(csrf()).cookie(dir).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"rate\":\"99\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("product.vatBulkStale"));
        assertThat(vatOf(a)).isEqualByComparingTo(other);

        mvc.perform(post("/api/products/vat-bulk").with(csrf()).cookie(dir).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"rate\":\"" + rate + "\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.rate").value(rate));
        assertThat(vatOf(a)).isEqualByComparingTo(rate);
        assertThat(vatOf(b)).isEqualByComparingTo(rate);
        assertThat(vatOf(exempt)).isEqualByComparingTo("0");
        assertThat(jdbc.sql("SELECT vat_exempt FROM product WHERE id = :id").param("id", exempt).query(Boolean.class).single()).isTrue();
        assertThat(jdbc.sql("SELECT version FROM product WHERE id = :id").param("id", same).query(Long.class).single()).isEqualTo(versionBefore);
        assertThat(jdbc.sql("SELECT count(*) FROM audit_log WHERE action = 'product.vatBulk'").query(Long.class).single()).isPositive();

        mvc.perform(get("/api/products/vat-bulk/preview").cookie(dir))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.affected").value(0));
    }

    @Test
    void requiresSettingsEdit() throws Exception {
        Cookie op = loginAs("OPERATOR");
        mvc.perform(get("/api/products/vat-bulk/preview").cookie(op)).andExpect(status().isForbidden());
        mvc.perform(post("/api/products/vat-bulk").with(csrf()).cookie(op).contentType(MediaType.APPLICATION_JSON).content("{\"rate\":\"12\"}"))
                .andExpect(status().isForbidden());
    }
}
