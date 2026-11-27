# 100+ (yuzplus) — mustaqil arxitektura auditi

**Sana:** 27.11.2026 · **Commit:** `adf112b7` (worktree `/home/claude/audit-src`)
**Usul:** faqat kod, migratsiyalar, testlar, konfiguratsiya, CI workflow'lar va `docs/SPEC.md` (mezon sifatida) o'qildi. Sessiya jurnallari, hisobotlar va avvalgi xulosalar o'qilmadi.
Backend kompilyatsiya qilinmadi (muhitda Maven/Gradle yopiq), shuning uchun backend bo'yicha xulosalar **statik tahlil**. Frontend mahalliy tekshirildi: `pnpm typecheck` ✅, `pnpm lint` ✅, `pnpm test` ✅ (144 fayl, 680 test).
Production'ga murojaat qilinmadi: deploy muhitidagi haqiqiy env qiymatlari **tekshirilmadi**.

---

## XULOSA

1. **Arxitektura asosan to'g'ri.** Modulli monolit, 13 Spring Modulith moduli, modullararo Java importlari faqat ochiq API klasslariga (`PartyLedger`, `StockLedger`, `Notifications` …), `ModularityTest` mavjud. Sikl topilmadi.
2. **Pul/qoldiq yadrosi kuchli:** qo'shiladigan jurnallar (`stock_move`, `party_ledger`, `money_move`, `audit_log`) trigger bilan himoyalangan, `CHECK (qty >= 0)` / `CHECK (balance >= 0)`, barqaror tartibli `FOR UPDATE`, taqsimotda advisory lock, hamma joyda `BigDecimal`. Parallel holat testlari 16 ta IT faylda bor.
3. **Toza bo'lmagan joylar:** (a) optimistik qulf faqat nomigagina — `version` ustuni oshiriladi, lekin hech qayerda solishtirilmaydi; (b) modul chegarasi SQL orqali chetlab o'tiladi (sales → delivery/inventory jadvallari); (c) ro'yxatlarda N+1 (har qator uchun kredit holati — 3 ta qo'shimcha so'rov); (d) V107 da qurilgan `party_doc_balance` hosila jadvali eng ko'p chaqiriladigan `PartyLedger.openDocs` da ishlatilmaydi.
4. **Xavfsizlik:** `@PreAuthorize` amalda har endpointda (ochiqlari faqat login/csrf/login-info/mobil login), filial filtri serverda izchil. Zaif joylar konfiguratsiyada: Swagger/OpenAPI va `forward-headers` standart qiymatlari Railway yo'riqnomasida yopilmagan.
5. **Eng katta xavf — zaxira nusxa:** GitHub Actions zaxirasi ochiq repoda yoki sirlar yo'q bo'lsa **jimgina o'tib ketadi** (yashil, ogohlantirishsiz). Railway yo'lida PITR (WAL arxiv) yo'q.
6. **Birinchi navbatda:** I1 (zaxira haqiqatda olinayotganini kafolatlash va jim o'tishni yo'qotish) → C1/C2 (prod env) → D2/D1 (N+1 va qarz hisobini hosila jadvalga o'tkazish — «sekin» degan shikoyatning asosiy sababi) → B1 (yo'qolgan yangilanish) → F1 (SSE bitta oqimi) → G1 (E2E jim skip).

Topilmalar: **🔴 1 · 🟠 11 · 🟢 22** (jami 34).

---

## 1. Modul chegaralari va bog'liqliklar

**Yaxshi:** `ApplicationModules.of(...).verify()` (`backend/src/test/java/uz/yuzplus/ModularityTest.java:11`); boshqa modullardan faqat ochiq klasslar import qilinadi (`finance.PartyLedger`, `inventory.StockLedger`, `notification.Notifications`, `finance.opening` — `@NamedInterface`, `backend/src/main/java/uz/yuzplus/finance/opening/package-info.java:2`). Jurnal jadvallariga yozish faqat egasi modul klassida (`INSERT INTO stock_move` — faqat `inventory/StockLedger.java`, `INSERT INTO party_ledger` — faqat `finance/PartyLedger.java`).

**A1 🟢 `warehouse` moduli bo'sh.**
DALIL: `backend/src/main/java/uz/yuzplus/warehouse/package-info.java:1-3` — modulda faqat package-info; SPEC 11 bo'yicha shu yerda bo'lishi kerak bo'lgan yig'ish/markirovka `sales/order/OrderPicking.java`, `sales/order/OrderMarking.java` da.
TA'SIRI: SPEC va kod tuzilmasi mos emas; `sales` moduli 46 fayl / ~10,3 ming qator bo'lib ketgan.
TAVSIYA: yo `warehouse` ni olib tashlab SPEC ni yangilash, yo yig'ish/markirovka/tekshiruvni `warehouse` ga ko'chirish (sales'dan hodisa orqali).

**A2 🟠 Modul chegarasi SQL orqali chetlab o'tiladi.**
DALIL: `sales/order/Orders.java:478` — buyurtmalar ro'yxati delivery modulining `trip_stop`, `trip` jadvallarini to'g'ridan-to'g'ri o'qiydi (yana `:777`); `sales/order/Orders.java:865-866` — inventory'ning `stock_balance`, `stock_reservation` jadvallari; `delivery/trip/TripOrderListener.java:49-52` va boshqalar. `ModularityTest` faqat Java bog'liqliklarini tekshiradi, SQL'ni ko'rmaydi.
TA'SIRI: delivery/inventory jadval tuzilmasi o'zgarsa sales jimgina buziladi; modul «ochiq API» qoidasi amalda faqat yozish uchun ishlaydi.
TAVSIYA: o'qish uchun ham egasi modulda ochiq so'rov metodi (`Trips.driverFor(orderIds)`, `StockAvailability`) yoki reporting uchun alohida o'qish ko'rinishi (view). Hech bo'lmasa ruxsat etilgan modullararo jadvallar ro'yxatini ArchUnit/grep testi bilan qotirish.

**A3 🟢 SPEC 11.9 dagi «Modulith hodisalari» deyarli ishlatilmaydi.**
DALIL: butun backendda 2 ta `@EventListener` (`delivery/trip/TripOrderListener.java:22`, `:49`), ular sinxron, shu tranzaksiyada. Qolgan modullararo ish — to'g'ridan-to'g'ri chaqiruv (masalan `sales/order/OrderSales.java:174` → `PartyLedger.record`).
TA'SIRI: xato emas (bitta tranzaksiya — yaxlitlik uchun hatto yaxshi), lekin SPEC bilan mos emas va `sales` → `finance`/`inventory`/`pricing`/`notification` bog'liqligi qattiq.
TAVSIYA: SPEC'ni amaldagi qarorga moslab yozish («hujjatni o'tkazish — sinxron ochiq API, bildirishnoma — hodisa»).

---

## 2. Pul / qoldiq / qarz yaxlitligi

**Yaxshi:** `StockLedger.post` — satrlar (zona, partiya) tartibida `FOR UPDATE`, manfiy qoldiqqa tekshiruv, jurnal + qoldiq bitta tranzaksiyada (`inventory/StockLedger.java:119-189`); bazada `stock_balance.qty CHECK (qty >= 0)` va jurnal append-only triggeri (`db/migration/V10__stock.sql:47-58`); pul hisobi `money_account.balance CHECK (balance >= 0)` + `money_move` append-only (`V25__customer_payments.sql:14, 35`); `MoneyLedger` hisob satrini qulflaydi (`finance/MoneyLedger.java:42`); to'lov taqsimoti kontragent bo'yicha advisory lock bilan (`finance/payment/Payments.java:278-279, 371-377`); tasdiqlangan hujjatlar triggerlar bilan qulflangan (54 ta migratsiyada `CREATE TRIGGER`); pul uchun `double` ishlatilmagan (topilgan `double` lar — daqiqa o'rtachasi `reporting/workers/AccountantReport.java:67-78` va nom o'xshashligi `pricing/reference/ReferencePrices.java:53-54`, ular pul emas).

**B1 🟠 Optimistik qulf faqat nomigagina: `version` hech qachon solishtirilmaydi.**
DALIL: `catalog/counterparty/Counterparties.java:203-216` — `UPDATE counterparty SET … version = version + 1 WHERE id = :id` (kutilgan versiya shartsiz); xuddi shunday `Counterparties.java:424, 545` (kredit limiti, narx turi — `counterparty_branch_terms`), `catalog/product/Products.java:366`. Butun backendda `AND version = :…` ko'rinishidagi shart **0 ta**. Versiya frontendga yuboriladi (`finance/payment/PaymentModels.java:86`), lekin qaytib tekshirilmaydi.
TA'SIRI: ikki xodim bir kartani (masalan mijozning kredit limitini) bir vaqtda tahrirlasa — oxirgi saqlagan g'olib, birinchisining o'zgarishi jimgina yo'qoladi («lost update»). Hujjatlar uchun xavf past: ular `FOR UPDATE` + holat tekshiruvi bilan himoyalangan (`finance/payment/Payments.java:240-244`).
TAVSIYA: tahrir so'rovlariga `version` maydonini qo'shib, `WHERE id = :id AND version = :v` va `update() == 0` bo'lsa 409 `error.staleVersion` qaytarish; kamida kredit limiti, narx turi, mahsulot kartasi uchun.

**B2 🟠 Kredit limiti tekshiruvi boshqa ochiq buyurtmalarni hisobga olmaydi va mijoz bo'yicha qulfsiz (ehtimol biznes qoidaga zid).**
DALIL: `sales/order/Orders.java:300-313` — `exposure = cs.debt() + total`, bu yerda `cs.debt()` faqat `party_ledger` dagi (o'tkazilgan sotuvlar) qarz; tasdiqlangan, lekin hali sotuvga aylanmagan buyurtmalar summasi qo'shilmaydi; mijoz qatori yoki advisory lock olinmaydi.
TA'SIRI: limiti 10 mln bo'lgan mijozga 8 mln dan ikki buyurtma (yoki bir vaqtda ikki operator) — ikkalasi ham tasdiqsiz o'tadi, jami ochiq majburiyat 16 mln. SPEC 6: «limit oshsa — tasdiqqa ketadi». Qoida «qarz» deb talqin qilinsa — xato emas; **egasi bilan aniqlashtirish kerak**.
TAVSIYA: exposure ga `QUEUED…IN_TRANSIT` holatidagi buyurtmalar summasini qo'shish va baholashni `party:CUSTOMER:<filial>:<mijoz>` advisory lock ostida bajarish (to'lovlardagi bilan bir xil kalit).

**B3 🟢 «Zahira ≤ qoldiq» invarianti faqat har chiqim joyida qo'lda tekshiriladi.**
DALIL: `StockLedger.post` (`inventory/StockLedger.java:142-167`) faqat `qty ≥ 0` ni tekshiradi, faol zahirani emas; zahirani ayirish har chaqiruvchida alohida: `inventory/writeoff/WriteOffs.java:379-392`, `purchasing/receipt/SupplierReturns.java:376-392` (bir xil kod, ikki modulda).
TA'SIRI: yangi chiqim turi qo'shilganda tekshiruvni unutish oson → zahiralangan tovar boshqa hujjat bilan chiqib ketadi, buyurtma yig'ishda «yetmaydi» bo'ladi.
TAVSIYA: `StockLedger.postRespectingReservations(...)` (yoki `Move` da `respectReserved` belgisi) — tekshiruv bitta joyda.

**B4 🟢 Hujjat raqami alohida autocommit ulanishda — rollback'da raqamda bo'shliq qoladi.**
DALIL: `shared/numbering/DocumentSequenceService.java:46-60` (alohida hovuz `:76-97`).
TA'SIRI: qasddan qilingan qaror (navbat qulfi qisqa), raqamlar UNIQUE, lekin ketma-ket emas. Soliq/buxgalteriya talab qilsa muammo bo'lishi mumkin.
TAVSIYA: qarorni SPEC 7 da yozib qo'yish; agar uzluksiz raqam kerak bo'lsa — raqamni o'tkazish tranzaksiyasi ichida berish.

**B5 🟢 Baza cheklovi buzilishi (UNIQUE/CHECK/deadlock) foydalanuvchiga «kutilmagan xato» (500) bo'lib qaytadi.**
DALIL: `shared/error/GlobalExceptionHandler.java:83-93` — `DataIntegrityViolationException`, `CannotAcquireLockException` uchun alohida ishlov yo'q, hammasi `error.unexpected` + `systemErrors.record`.
TA'SIRI: parallel holatda baza to'g'ri himoya qilsa ham, foydalanuvchi «nima qilish kerak» xabarini olmaydi; tizim xatolari jurnali shovqinlanadi.
TAVSIYA: ularni 409 `error.conflictRetry` ga xaritalash (pul yaxlitligi o'zgarmaydi).

---

## 3. Xavfsizlik

**Yaxshi:** `@PreAuthorize` 541 marta; skript bilan tekshirilganda annotatsiyasiz endpointlar faqat `/api/auth/login`, `/api/auth/csrf`, `/api/auth/login-info`, `/api/mobile/auth/login|password` (`identity/security/SecurityConfig.java:63-64`). Filial doirasi izchil (`shared/security/Actor.java:11-25`; masalan `finance/debt/Debts.java:257, 283`, `delivery/trip/Trips.java:236-238`, `finance/cash/CashOps.java:93`). CSRF — SPA cookie + sarlavha (`SecurityConfig.java:51-55`); sessiya cookie httpOnly/Secure/SameSite=Lax (`:105-114`); mobil token — Bearer, noto'g'ri token cookie'ga qaytmaydi (`identity/security/MobileTokenFilter.java:36-39`), mobil ilovada SecureStore (`mobile/src/lib/session.ts:1-12`). Tannarx asosiy ombor API'larida `special.cost` bilan yashiriladi (`inventory/StockOverviewController.java:803-805`). Kodda haqiqiy sir topilmadi (CI'dagi parollar faqat sinov bazasi uchun: `.github/workflows/ci.yml:91-101`).

**C1 🟠 OpenAPI va Swagger UI standart holatda hammaga ochiq.**
DALIL: `identity/security/SecurityConfig.java:70-71` (`/api/openapi/**`, `/api/docs/**` — `permitAll`); `backend/src/main/resources/application.yml:86-91` (`enabled: ${YUZPLUS_API_DOCS:true}`). `deploy/docker-compose.yml` da `YUZPLUS_API_DOCS: "false"` bor, lekin Railway yo'riqnomasidagi env ro'yxatida yo'q (`docs/RAILWAY.md:13-21`).
TA'SIRI: Railway'da sozlanmagan bo'lsa (tekshirilmadi), tizimning barcha endpointlari, parametrlari va ruxsat nomlari login'siz ko'rinadi — hujumchiga xarita.
TAVSIYA: standartni `false` qilish (`${YUZPLUS_API_DOCS:false}`), CI'da `true` berish; yoki `permitAll` o'rniga `hasAuthority('settings.security')`.

**C2 🟠 `forward-headers-strategy` standarti `none` — proksi ortida audit IP noto'g'ri bo'ladi.**
DALIL: `application.yml:42`; IP audit va sessiyaga `getRemoteAddr()` dan yoziladi (`shared/audit/AuditLog.java:55`, `identity/auth/AuthController.java:95`). Compose'da `YUZPLUS_FORWARD_HEADERS: native` bor, Railway ro'yxatida yo'q (`docs/RAILWAY.md:13-21`).
TA'SIRI: (ehtimol) Railway/Next proksisi ortida barcha kirishlar va audit yozuvlarida bir xil ichki IP — tergov/nazorat uchun audit qiymatsiz.
TAVSIYA: Railway env'ga `YUZPLUS_FORWARD_HEADERS=native` (yoki `framework`) qo'shish va ishonchli proksi doirasini cheklash.

**C3 🟢 Kirish bloklash faqat login bo'yicha — istalgan hisobni 15 daqiqaga yopish mumkin.**
DALIL: `identity/security/LoginThrottle.java:19-20, 41-59` — 5 ta noto'g'ri urinish → login (mavjud bo'lmasa ham) 15 daqiqa yopiladi; IP bo'yicha cheklov yo'q.
TA'SIRI: login nomini bilgan har kim direktor/kassirni ish vaqtida qayta-qayta bloklay oladi (DoS); bir IP'dan ko'p loginlarni sinash cheklanmaydi.
TAVSIYA: IP bo'yicha qo'shimcha hisoblagich (C2 tuzatilgandan keyin) va login bloklanganda «PIN/rahbar orqali ochish».

**C4 🟢 Tannarx bo'yicha saralash ruxsatsiz foydalanuvchiga ham ochiq (bilvosita sizish).**
DALIL: `inventory/StockOverviewController.java:388` + `:423` (`COST_SUM -> "bal.qty * bal.cost"`), `:260` + `:789`; `sort` parametri `showCost` ga bog'lanmagan.
TA'SIRI: summa ko'rinmasa ham, tannarx bo'yicha tartib (qaysi partiya qimmatroq) ko'rinadi. SPEC 13: «API ham tannarx maydonini yubormaydi» — ruhiga zid, jiddiy emas.
TAVSIYA: `!showCost` bo'lsa `COST_SUM` ni `NAME` ga almashtirish yoki 403.

**C5 🟢 Tannarx ko'rinishi ikki xil ruxsat kaliti bilan boshqariladi.**
DALIL: ombor — `special.cost` (`StockOverviewController.java:803-805`); mijoz hujjatlarida «Baza narxi»/«Ust.%» — `invoices.costPrint` (`sales/order/ClientDocController.java:23`, `sales/order/ClientDocs.java:542-543, 643-644`).
TA'SIRI: rol matritsasida bittasini olib, ikkinchisini qoldirish oson — tannarx boshqa yo'ldan ko'rinadi.
TAVSIYA: `invoices.costPrint` ni `special.cost` ga bog'lash (ikkalasini talab qilish) yoki rol muharririda ogohlantirish.

**C6 🟢 Baza paroli uchun koddagi standart qiymat.**
DALIL: `application.yml:5-7` — `${YUZPLUS_DB_PASSWORD:${MEDIX_DB_PASSWORD:yuzplus}}`.
TA'SIRI: env unutilsa ilova `yuzplus` paroli bilan ulanishga urinadi (xato yashirinadi); eski `MEDIX_*` nomlari ham hali o'qiladi.
TAVSIYA: prod profilida standartni olib tashlash (`${YUZPLUS_DB_PASSWORD}` — yo'q bo'lsa ishga tushmasin); fallback nomlarini muddat bilan olib tashlash.

---

## 4. Ma'lumotlar bazasi

**Yaxshi:** asosiy filtrlar uchun indekslar (`V106__s1_query_indexes.sql:5-13` — filial+sana, qoplovchi `INCLUDE`, trigram qidiruv; `V12__receipts.sql:21-22` — `party_ledger`); `stock_reservation` faol zahira uchun qisman indeks (`V16__reservations.sql:20`); migratsiyalar V1…V122 bo'shliqsiz; `party_doc_balance` trigger bilan jurnal tranzaksiyasida yangilanadi (`V107__party_doc_balance.sql:44-66`).

**D1 🟠 `party_doc_balance` hosila jadvali eng ko'p ishlatiladigan yo'lda qo'llanmagan.**
DALIL: V107 o'zi muammoni yozadi: butun jurnalni hujjat bo'yicha guruhlash 1,4 s / 4,8 s (`V107__party_doc_balance.sql:1-9`). Jadval hisobotlarda ishlatiladi (`finance/debt/DebtSummariesService.java`, `reporting/home/DirectorHome.java`), lekin `PartyLedger.openDocs` / `creditState` / `remainingDebts` hamon `party_ledger` ni CTE bilan guruhlaydi (`finance/PartyLedger.java:120-143, 151-152, 178-179`).
TA'SIRI: `openDocs` mijozning butun tarixini o'qiydi va u har buyurtma baholashida (`sales/order/Orders.java:301`), ro'yxatning har qatorida (D2), tasdiq navbatida, har to'lov o'tkazishda (`finance/payment/Payments.java:280`) chaqiriladi; katta mijozlarda vaqt bilan sekinlashadi.
TAVSIYA: `openDocs` ni `party_doc_balance WHERE own_rows > 0 AND open_amount <> 0` (mavjud qisman indeks bilan) ga o'tkazish; jurnaldan qayta qurish bilan solishtiruvchi IT test (`finance/PartyDocBalanceIT.java` asosida) qo'shish.

**D2 🟠 N+1: ro'yxatlarda har qator uchun kredit holati alohida hisoblanadi.**
DALIL: `sales/order/Orders.java:496` → `withCreditFlag` (`:564-588`) har DRAFT/PENDING qator uchun 3 so'rov: `customer()` (`:170-176`), `terms()` (`:178-188`), `creditState()` (D1 dagi og'ir CTE); sahifa hajmi 200 gacha (`sales/order/OrderController.java:117`). Tasdiq navbati — `LIMIT` siz ro'yxat (`reporting/approvals/ApprovalsQueue.java:107-120`) va har qator uchun `creditState` (`:124-126`). Operator bosh sahifasi — `reporting/home/OperatorHome.java:175-176` (3 qator, kam ta'sir).
TA'SIRI: 200 qatorli sahifada qoralamalar ko'p bo'lsa — yuzlab qo'shimcha so'rov; tasdiq navbati kutayotgan buyurtmalar soniga chiziqli sekinlashadi. «Buyurtmalar sahifasi sekin ochiladi» shikoyatining ehtimoliy asosiy sababi.
TAVSIYA: sahifadagi mijozlar ro'yxati bo'yicha bitta guruhlangan so'rov (`party_doc_balance` dan `customer_id IN (:ids)`), terms va counterparty — bitta JOIN; tasdiq navbatiga `LIMIT`/sahifalash.

**D3 🟢 Buyurtmalar ro'yxatida har qatorga 6 ta bog'liq subquery va `OFFSET` sahifalash.**
DALIL: `sales/order/Orders.java:471-480`.
TA'SIRI: indekslar bor (tez), lekin chuqur sahifalarda `OFFSET` butun oldingi qatorlarni o'qiydi.
TAVSIYA: `LEFT JOIN LATERAL` yoki oldindan JOIN; uzoq tarix uchun keyset sahifalash.

**D4 🟢 Indekslar `CONCURRENTLY` siz yaratiladi.**
DALIL: `V106__s1_query_indexes.sql:5-13`, `V110__stock_balance_lock_index.sql:5`.
TA'SIRI: katta jadvalda deploy paytida yozish bloklanadi (Flyway tranzaksiyasi davomida).
TAVSIYA: katta jadvallar uchun alohida tranzaksiyasiz migratsiya (`-- flyway:executeInTransaction=false` + `CREATE INDEX CONCURRENTLY`).

**D5 🟢 Fotosuratlar asosiy bazada `BYTEA` (append-only).**
DALIL: `V23__delivery.sql:14-25` (`delivery_photo.data BYTEA`, o'chirish trigger bilan taqiqlangan), `V114__trip_expense.sql:73`.
TA'SIRI: har yetkazish/chek rasmi (5 MB gacha, `delivery/trip/Trips.java:537`) baza va har kunlik zaxira hajmini o'stiradi; o'chirib bo'lmaydi. SPEC 15 da MinIO rejalashtirilgan.
TAVSIYA: rasmlarni obyekt omboriga, bazada faqat kalit + xesh.

---

## 5. Frontend

**Yaxshi:** typecheck/lint/680 test yashil; yuklanish/bo'sh/xato/ruxsat holatlari keng (`ErrorState` 136 faylda, `ForbiddenState` 90 faylda); SSE hodisalari 1–2,5 s ichida birlashtiriladi va yashirin varaqda kechiktiriladi (`frontend/components/shell/live-sync.tsx:15-37`); SSE uzilishida eksponensial qayta ulanish (`frontend/lib/live.ts:27-37, 76-83`); xavfsizlik sarlavhalari va CSP (`frontend/next.config.ts:15-38`); 4xx da qayta urinish yo'q (`frontend/lib/api/query-client.ts:6-9`).

**E1 🟢 Ba'zi sahifalar SSE ulanganda ham tez-tez so'raydi.**
DALIL: `frontend/features/orders/monitor-page.tsx:158` (`refetchInterval: 15_000` — `live` ga bog'lanmagan), `frontend/features/orders/issues.tsx:106` (15 s), `frontend/features/payments/cash-page.tsx:58` (30 s). Monitor sahifasi o'zi 5+ so'rov (`monitor-page.tsx:154-181`) + qobiq (nav-badges, bildirishnoma qo'ng'irog'i).
TA'SIRI: har ochiq monitor oynasi daqiqasiga ~4+ so'rov; xodimlar ko'paysa backend va Spring Session (F4) yuklamasi chiziqli o'sadi.
TAVSIYA: `useLivePoll(…)` ni hamma joyda qo'llash (SSE bor — 60–300 s).

**E2 🟢 Fokusda va qayta ulanishda hamma faol so'rovlar qayta bajariladi.**
DALIL: `frontend/lib/api/query-client.ts:15-17` (`refetchOnWindowFocus: true`, `staleTime: 30_000`); `frontend/lib/live.ts:58-61` — `ready` hodisasida barcha obunachilar chaqiriladi.
TA'SIRI: oynalar orasida tez-tez almashadigan xodimda (kassir, operator) har qaytishda so'rovlar to'lqini; SSE tez-tez uzilsa (F2) — har uzilishda.
TAVSIYA: og'ir ro'yxatlar uchun `refetchOnWindowFocus: false` (SSE baribir yangilaydi) yoki `staleTime` ni oshirish.

---

## 6. Unumdorlik («nega sekin / qotadi»)

**Yaxshi:** sekin so'rovlar jurnali (`shared/web/SlowRequestLog.java:49`), brauzer vaqtlarini yig'ish (`shared/web/ClientTimingController.java`), filtr variantlari keshi (`sales/order/Orders.java:502-538`), SSE sarlavhalari proksi buferlamasligi uchun (`notification/NotificationController.java:80`).

**F1 🟠 SSE yuborish bitta oqimda — bitta sekin mijoz hammaning signallarini to'xtatadi.**
DALIL: `notification/NotificationStream.java:37-41` (`newSingleThreadExecutor`), barcha yuborish `:69, :90, :124` shu oqimda; `emitter.send` bloklovchi (`:139-141`). Registr xotirada — faqat bitta server nusxasi uchun (`:24`).
TA'SIRI: mobil/sekin tarmoqdagi bitta varaqning TCP buferi to'lsa, `send` kutadi va boshqa barcha xodimlarga «buyurtma o'zgardi» signali kechikadi → sahifalar «qotgandek», keyin zaxira polling bilan yangilanadi. Ikkinchi backend nusxasi qo'shilsa SSE yarim foydalanuvchilarda ishlamaydi.
TAVSIYA: har emitter uchun chegaralangan navbat yoki yuborishni bir nechta oqimga (virtual threads) bo'lish va yozish vaqtiga chegara; ko'p nusxa uchun LISTEN/NOTIFY allaqachon bor (`notification/LiveSignalListener.java`) — registrni shunga moslash.

**F2 🟠 Har API so'rovi Next server orqali ikki sakrash qiladi; SSE ham proksi orqali.**
DALIL: `frontend/next.config.ts:55-57` (`/api/:path*` → `BACKEND_URL`); `docs/RAILWAY.md:30` (ichki domen), `frontend/vercel.json` — `main` Vercel'ga ham joylanadi.
TA'SIRI: Railway'da (ichki tarmoq) qo'shimcha kechikish kichik. Agar frontend Vercel'da bo'lsa (ehtimol), har so'rov Vercel → ommaviy internet → Railway bo'ladi va uzoq SSE oqimlari proksi vaqt chegarasida uziladi (tekshirilmadi) → E2 dagi «hammasini qayta so'rash» to'lqini. Bundan tashqari `docs/RAILWAY.md:23` backendga ommaviy domen bermaslikni aytadi — bu holda Vercel frontendi backendga yeta olmaydi; joylashuv konfiguratsiyasi noaniq.
TAVSIYA: bitta prod yo'lini tanlash (frontend va backend bir mintaqa/tarmoqda); SSE ni to'g'ridan-to'g'ri backend subdomeniga (cookie domeni bilan) yoki uzoq ulanishni qo'llaydigan proksiga.

**F3 🟢 Ulanish hovuzi standart (10), bittasi doimiy band.**
DALIL: `application.yml:4-10` — `hikari.maximum-pool-size` berilmagan (standart 10); `notification/LiveSignalListener.java:59-70` asosiy hovuzdan ulanishni abadiy ushlab turadi; raqamlash va rejalashtiruvchi uchun alohida kichik hovuzlar (`shared/numbering/DocumentSequenceService.java:28`, `shared/error/SchedulerConfig.java:21`).
TA'SIRI: bir nechta og'ir hisobot (Direktor bosh sahifasi, 120 s polling) + hujjat o'tkazish bir vaqtda bo'lsa 9 ulanish tugaydi → so'rovlar navbatda kutadi («qotish»).
TAVSIYA: hovuz hajmini aniq belgilash (masalan 20), LISTEN uchun alohida `DriverManager` ulanishi, hisobotlar uchun `statement_timeout`.

**F4 🟢 Spring Session JDBC har so'rovda sessiya qatorini yangilaydi (ehtimol).**
DALIL: `application.yml:34-37` — maxsus `flush-mode`/sozlama yo'q; Spring Session JDBC standart holatda har so'rovda `LAST_ACCESS_TIME` ni yozadi (kutubxona xatti-harakati, bu yerda o'lchanmadi).
TA'SIRI: polling (E1) bilan birga — o'qish so'rovlari ham bazaga yozuv hosil qiladi.
TAVSIYA: `pg_stat_statements` bilan o'lchash; kerak bo'lsa `spring_session` UPDATE chastotasini kamaytirish (masalan, faqat N daqiqada bir) yoki polling'ni kamaytirish.

---

## 7. Testlar

**Yaxshi:** 96 backend test fayli (69 IT, Testcontainers PostgreSQL 18), parallel holat testlari 16 IT faylda (`inventory/StockLedgerIT.java`, `finance/PaymentIT.java`, `finance/CashIT.java`, `shared/numbering/DocumentSequenceServiceIT.java` …); ruxsatlar testi (`identity/security/EndpointPermissionsIT.java`); frontend 680 birlik testi; E2E CI'da haqiqiy backend bilan (`.github/workflows/ci.yml:82-158`).

**G1 🟠 E2E testlari bir-biriga bog'liq va ma'lumot bo'lmasa jimgina o'tkazib yuboriladi.**
DALIL: `frontend/e2e/zzz-o18-invoice-forms.spec.ts:31, 36`, `frontend/e2e/zzz-ft6-client-docs.spec.ts:31`, `frontend/e2e/zzz-ft-invoice-edit.spec.ts:30` — `test.skip(items.length === 0, …)`; fayl nomlari `zz…/zzz…` bilan tartib majburlangan, `workers: 1`, `retries: 0` (`frontend/playwright.config.ts:9-11`).
TA'SIRI: oldingi test buyurtma yaratmasa, faktura/hujjat testlari «yashil» (skip) bo'ladi — regressiya ko'rinmaydi; bitta testni alohida ishga tushirib bo'lmaydi.
TAVSIYA: har spec o'z ma'lumotini API orqali tayyorlasin (fixture), CI'da skip soni > 0 bo'lsa yiqilsin.

**G2 🟢 Qat'iy kutishlar.**
DALIL: `frontend/e2e/zw-devices.spec.ts:83`, `frontend/e2e/zv-role-sweep.spec.ts:66`, `frontend/e2e/zzz-o24-dark-pages.spec.ts:34` (`waitForTimeout`); `backend/src/test/java/uz/yuzplus/notification/NotificationStreamIT.java:59` (`Thread.sleep(100)`).
TA'SIRI: sekin runner'da beqarorlik manbai.
TAVSIYA: `expect.poll` / Awaitility bilan holatni kutish.

**G3 🟢 Testlar bir faylga to'plangan; `delivery` modulining o'z testi yo'q.**
DALIL: `backend/src/test/java/uz/yuzplus/sales/OrderIT.java` — 3397 qator; `backend/src/test/java/uz/yuzplus/` da `delivery/` papkasi yo'q, reys/haydovchi/xarajat ssenariylari `OrderIT.java` ichida (`:3159, :3262`).
TA'SIRI: bitta yiqilish uzun faylda qidiriladi, modul testlari modul bilan birga yashamaydi; `ApplicationModuleTest` bilan modulni alohida sinash imkoni yo'qoladi.
TAVSIYA: `OrderIT` ni ssenariy bo'yicha bo'lish, umumiy tayyorlovni test-fixture klassiga chiqarish, `delivery` testlarini o'z papkasiga.

---

## 8. Kod tozaligi

**Yaxshi:** izchil uslub (record DTO, i18n xato kalitlari `YuzplusException`), pul formatlash bitta joyda (`shared/money`), generatsiya qilingan API tiplari (`frontend/lib/api/schema.ts`).

**H1 🟢 Juda katta klasslar va controllerda SQL.**
DALIL: `sales/order/Orders.java` 1388 qator, `delivery/trip/Trips.java` 1014, `sales/order/OrderInvoiceForms.java` 990, `purchasing/receipt/Receipts.java` 944; `inventory/StockOverviewController.java` (806 qator) — controller ichida to'g'ridan-to'g'ri SQL; `finance/payment/PaymentOverviews.java:31, 122` — servis va controller bitta faylda. Frontend: `features/orders/order-drawer.tsx` 1530, `features/receipts/receipt-drawer.tsx` 1345, `features/payments/payment-doc-page.tsx` 1270.
TA'SIRI: o'zgarish xavfi va ko'rib chiqish qiyinligi oshadi.
TAVSIYA: o'qish (query) va yozish (posting) servislarini ajratish; controller faqat parametr → servis.

**H2 🟢 Takroriy kod.**
DALIL: kontragent qulfi uch nusxada — `finance/payment/Payments.java:371-377`, `finance/payment/SupplierPayments.java:366-372`, `finance/payment/AdvanceOffsets.java:75-82`; `checkFree` ikki modulda — `inventory/writeoff/WriteOffs.java:379`, `purchasing/receipt/SupplierReturns.java:376`; `DocRef` uch nusxada — `inventory/StockLedger.java:28`, `finance/PartyLedger.java:24`, `finance/MoneyLedger.java:20`; import ustalari `features/products/import-wizard.tsx` (897) va `features/counterparties/import-wizard.tsx` (928).
TA'SIRI: qulf kaliti formati bir joyda o'zgarsa, boshqa joyda parallel himoya jimgina yo'qoladi.
TAVSIYA: `PartyLedger.lock(side, branch, counterparty)` va `StockLedger` ichida zahira tekshiruvi (B3).

**H3 🟢 O'lik bog'liqliklar va SPEC bilan nomuvofiqlik.**
DALIL: `backend/build.gradle.kts:33` — `spring-boot-starter-data-jpa`, lekin kodda `@Entity` 0 ta (hammasi `JdbcClient`); SPEC 10 dagi jOOQ ishlatilmaydi; `warehouse` moduli bo'sh (A1); eski nom qoldiqlari — `application.yml:5-7` (`MEDIX_*` fallback), SQL funksiyalari `medix_*` (`V21__trips.sql:64`).
TA'SIRI: ishga tushish vaqti va xotira (Hibernate bekorga yuklanadi), yangi dasturchini chalg'itadi.
TAVSIYA: JPA starterni `spring-boot-starter-jdbc` ga almashtirish; SPEC 10 ni amaldagi stekka moslash.

---

## 9. Deploy, zaxira, monitoring

**Yaxshi:** zaxiradan keyin darhol tiklash sinovi (`.github/workflows/backup.yml:52-56`, `scripts/backup/restore-test.sh`), shifrlash (AES256), compose yo'lida pgBackRest + WAL arxiv (`deploy/docker-compose.yml:20-27` — `wal_level`, `archive_command`), CI yiqilishi va zaxira yiqilishi Telegram'ga (`backup.yml:64-74`), uptime tekshiruvi (`.github/workflows/uptime.yml`), tizim xatolari jurnali va kunlik dayjest (`shared/error/SystemErrors.java:84`).

**I1 🔴 Zaxira nusxa jimgina o'tib ketishi mumkin; Railway yo'lida PITR yo'q.**
DALIL: `.github/workflows/backup.yml:22` — `if: github.event.repository.private` (ochiq repoda ish umuman ishlamaydi); `:28-37` — sirlar yo'q bo'lsa «o'tkazildi» deb **muvaffaqiyatli** tugaydi, Telegram ogohlantirishi faqat `failure()` da (`:64-65`); saqlash 14 kun va faqat GitHub artefaktida (`:62`). Railway yo'riqnomasi Railway Backups ni qo'lda yoqishga tayanadi (`docs/RAILWAY.md:48`); WAL arxiv (pgBackRest) faqat compose yo'lida.
TA'SIRI: repo ochiq bo'lsa yoki sir o'chib qolsa, kunlik zaxira olinmaydi va hech kim bilmaydi — server/baza yo'qolsa pul, qarz va qoldiq tarixi qaytarib bo'lmaydigan darajada yo'qoladi. Eng yaxshi holatda ham RPO = 24 soat (WAL yo'q). Haqiqiy holat (repo private-mi, sirlar bormi, Railway Backups yoqilganmi) **tekshirilmadi**.
TAVSIYA: (1) sirlar yo'q bo'lsa ishni **yiqitish** va Telegram'ga yozish; (2) oxirgi muvaffaqiyatli zaxira yoshini uptime ishida tekshirish (> 26 soat — ogohlantirish); (3) nusxani boshqa provayderga (S3-mos, boshqa mintaqa) ham yuborish; (4) prod uchun WAL/PITR (Railway Pro PITR yoki pgBackRest).

**I2 🟠 Ikki parallel prod konfiguratsiyasi, sozlamalar ajralib ketgan.**
DALIL: compose + Caddy + pgBackRest (`deploy/docker-compose.yml`, SPEC 15) va Railway/Vercel (`docs/RAILWAY.md`, `frontend/vercel.json`, `frontend/railway.toml`). `docs/RAILWAY.md:1` Railway'ni «sinov muhiti» deydi, `backup.yml:1-4` esa Railway'ni prod deb oladi. Compose'dagi xavfsizlik sozlamalari (`YUZPLUS_API_DOCS=false`, `YUZPLUS_FORWARD_HEADERS=native` — `deploy/docker-compose.yml`) Railway ro'yxatida yo'q (C1, C2). SPEC 13/15: ma'lumot O'zbekistonda saqlanishi talabi — Railway/Vercel bilan mosligi (ehtimol) yurist bilan tekshirilmagan.
TA'SIRI: qaysi muhit haqiqiy prod ekani noaniq; xavfsizlik va zaxira sozlamalari muhitga qarab farq qiladi.
TAVSIYA: bitta prod yo'lini rasman belgilash; env ro'yxatini bitta manbadan (masalan `deploy/.env.example`) va ishga tushishda majburiy tekshiruv (`@ConfigurationProperties` + `@Validated`).

**I3 🟢 Monitoring sayoz.**
DALIL: `.github/workflows/uptime.yml:5-6, 17-20` — private repoda har 30 daqiqada, faqat `/login` va `/api/auth/login-info` kodi; Prometheus endpoint ochilgan (`application.yml` `management…include: health,info,prometheus`), lekin uni yig'uvchi/ogohlantirish konfiguratsiyasi repoda yo'q.
TA'SIRI: 30 daqiqagacha uzilish sezilmaydi; «sekin» (lekin ishlayapti) holatlar, hovuz tugashi (F3), SSE ulanishlar soni kuzatilmaydi.
TAVSIYA: Hikari, javob vaqti p95, SSE ulanishlar soni, zaxira yoshi uchun oddiy ogohlantirishlar (Grafana Cloud bepul darajasi yoki Railway metrikalari).

---

## Egasi uchun qisqa variant

Dastur poydevori puxta qurilgan: pul, qarz va ombor qoldig'i «faqat qo'shiladigan daftar»ga yoziladi, baza o'zi minus qoldiqqa yoki tasdiqlangan hujjatni o'zgartirishga yo'l qo'ymaydi, bir vaqtda ishlash holatlari testlar bilan tekshirilgan. Jiddiy xavfsizlik teshigi topilmadi. Lekin quyidagilarni birinchi navbatda qilish kerak:

1. **Zaxira nusxani tekshiring (eng muhim).** Hozirgi sozlamada zaxira ba'zi holatlarda umuman olinmasligi va bu haqda xabar kelmasligi mumkin. Server buzilsa — butun hisob tarixi yo'qoladi. Zaxira olinmasa xabar keladigan qilish va nusxani ikkinchi joyda saqlash kerak.
2. **Prod sozlamalarini yopish.** API tavsifi (tizim xaritasi) login'siz ochiq bo'lishi mumkin, auditda esa kirgan odamning haqiqiy IP manzili yozilmayotgan bo'lishi mumkin. Bu ikki sozlama 10 daqiqalik ish.
3. **Sekinlikning asosiy sababi.** Buyurtmalar ro'yxati va tasdiq navbatida har qator uchun mijoz qarzi alohida hisoblanadi — buyurtma va mijoz ko'paygan sari sahifalar sekinlashadi. Tayyor «tez hisob» jadvali bor, faqat ulanmagan.
4. **Bir vaqtda tahrir.** Ikki xodim bir mijoz kartasini (masalan kredit limitini) birga o'zgartirsa, birinchisining o'zgarishi jimgina yo'qoladi. Shuningdek kredit limiti tekshiruvi hali yetkazilmagan buyurtmalarni hisobga olmaydi — bu biznes qoidasini siz tasdiqlashingiz kerak.
5. **Avtotestlarning bir qismi «yashil» ko'rinib aslida o'tkazib yuboriladi.** Ularni mustaqil qilish kerak, aks holda faktura bo'limidagi xato sezilmay qolishi mumkin.
