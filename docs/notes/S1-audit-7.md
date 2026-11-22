# S1 audit — 7-qism: xavfsizlik qayta skani (23.11.2026 tungi oyna, zaxira sessiya)

Statik koʻrik (kod oʻzgarmadi), natija — **yangi zaiflik topilmadi**.

| # | Tekshiruv | Natija |
|---|---|---|
| 1 | Har API metodida ruxsat: barcha `@RestController` larning `@Get/Post/Put/Delete/PatchMapping` metodlari skanerlandi (metod yoki klass darajasidagi `@PreAuthorize`) | Ruxsatsiz faqat atayin ochiqlari: `/api/auth/login`, `/csrf`, `/login-info`, mobil login/parol. Qolganlari — metod yoki klass darajasida (`SetupController` — `hasRole('DIRECTOR')`, `AuditController` — `audit.view`, `EmployeeController` — `staff.view`/`staff.edit`). `EndpointPermissionsIT` qoʻshimcha himoya. |
| 2 | SQL injection: `jdbc.sql(... + o'zgaruvchi ...)` ulanishlari | Barcha dinamik qismlar — enum `switch` (ORDER BY: `OrderSort`, `StockSort`, `BatchSort`, `ProductSort`, mahsulot roʻyxati) yoki kod ichidagi doimiy jadval/ustun nomlari (`checkRef("price_type")`, `lookup("unit")`, `PrintSettings.manual(…, "head_id")`, `DictionaryKind.table()`). Foydalanuvchi qiymati faqat `:param` orqali. |
| 3 | CSRF / sessiya cookie | `csrf.spa()` + `CookieCsrfTokenRepository`; sessiya cookie `Secure` (standart `true`), logout cookie oʻchiradi. |
| 4 | Parolni terib topish | `LoginThrottle` + `failed_login_count` (bloklash) mavjud. |
| 5 | API tavsifi / Swagger | Productionda `YUZPLUS_API_DOCS=false` bilan oʻchadi (S1-4); `/actuator/**` — faqat `settings.security`. |

Qolgan (egasidan): Dependabot alerts yoqish, zaxira joyi (S1-6 savoli). Skaner skripti — bir martalik, repoga qoʻshilmadi.
