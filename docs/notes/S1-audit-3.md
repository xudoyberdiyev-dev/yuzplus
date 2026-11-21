# S1 audit — 3-qism: yuklama sinovi (22.11.2026, tungi oyna)

## Qanday oʻlchandi

- **CI workflow** `.github/workflows/load.yml` (`s1-load` branch'iga push yoki qoʻlda ishga tushirish): GitHub runner'da
  PostgreSQL 18 (`shared_buffers=1GB`, `pg_stat_statements`), backend jar (`-Xmx1536m`, Hikari standart 10 ulanish),
  k6 — hammasi **bitta mashinada** (runner: 4 vCPU, 16 GB). Shuning uchun raqamlar production'dan **yomonroq** (k6 va
  backend PostgreSQL bilan bitta CPU'ni boʻlishadi) — farqlarni solishtirish uchun ishonchli, mutlaq qiymat — taxminiy.
- **Maʼlumot:** `scripts/s1/gen.sql` — 180 kun × 1 500 buyurtma/kun × 15 qator (270 ming buyurtma, 4 mln qator, 15 000
  mahsulot, 5 000 mijoz, 4 filial, 8 ombor), `scripts/s1/load-fixup.sql` — narxlar, ketma-ketliklar, `party_doc_balance`,
  150 ta sinov xodimi (Operator 70 %, Buxgalter, Ombor mudiri, Filial rahbari 10 % dan, Direktor 3).
- **Ssenariy** `scripts/s1/load.js`: 50 → 150 → 300 bir vaqtdagi foydalanuvchi (har bosqich 2 daqiqa), har biri bir marta
  kiradi va roli boʻyicha ishlaydi, har amal orasida 3–8 s «oʻylash». Operator: bosh sahifa, oʻz buyurtmalari, mijoz
  holati, katalog (qidiruv bilan va qidiruvsiz), **buyurtma yaratish (5 qator) → koʻrish → topshirish (zahira, FOR UPDATE)**,
  Ctrl+K. 60 ta «issiq» mahsulot — zahirada qulf toʻqnashuvi uchun. Buxgalter: bosh sahifa, mijozlar qarzi, buyurtmalar,
  oylik savdo hisoboti. Ombor mudiri: monitor, yigʻish navbati, qoldiqlar. Direktor: bosh sahifa (barcha filiallar),
  barcha buyurtmalar, qarz, savdo, audit.
- **Kuzatuvchi** `scripts/s1/sampler.sh`: har 5 s — Hikari (faol/kutayotgan), JVM, PostgreSQL faol ulanishlar va qulf kutish.

## 1-oʻlchov (tuzatishlardan oldin)

| Bosqich | Median | p95 | Izoh |
|---|---|---|---|
| 50 foydalanuvchi | 2,4 s | 5,2 s | allaqachon toʻyingan |
| 150 | 8,4 s | 18 s | Hikari: 10/10 band, 190 soʻrov navbatda |
| 300 | 18,8 s | 36 s | 30 s kutishdan keyin «Connection is not available» → 500 (1,7 % xato) |

Oʻtkazish qobiliyati: **14 soʻrov/s**. Deadlock — 0, buyurtma yaratildi 438, topshirildi 374.

**Sabab — maʼlumotlar bazasi CPU'si** (pg_stat_statements, umumiy vaqt boʻyicha):

1. **Bosh sahifalar** (Direktor, Buxgalter, Filial rahbari) qarz xulosasi uchun **toʻliq «Mijozlar qarzi» hisobotini**
   chaqirardi — barcha ochiq hujjatlar + har kontragent uchun oxirgi toʻlov / operator / zona soʻrovi (~0,9 s). Direktor bosh
   sahifasi buni **10 marta** (2 tomon × (barchasi + 4 filial)).
2. **Buyurtma katalogi** («Mahsulot qoʻshish»): har ochilishda 6 ta soʻrov (3 ta filtr varianti, belgilar soni, jami, sahifa),
   har biri omborning butun qoldigʻini qayta agregatlaydi (~450 ms × 6).
3. **Zahira qulfi**: `stock_balance WHERE warehouse_id AND product_id FOR UPDATE` — mos indeks yoʻq (mavjudlari qisman,
   `qty > 0`), har buyurtma qatori uchun butun jadval skani **qulf ostida** (108 ms; 480 ming qatorda yolgʻiz 27 ms).

## Tuzatishlar

| # | Nima | Natija (mahalliy, sintetik) |
|---|---|---|
| 1 | `Debts.aging()` / `agingByBranch()` — qarz yoshi kontragent soʻrovisiz; bosh sahifa xulosalari (`summary`, `byParty`) shundan, nom — faqat top-N uchun. Filial sharti alohida matn (generic reja muammosi yoʻq) | kontragent soʻrovi (~0,9 s) bosh sahifalardan chiqdi |
| 2 | Katalog: 3 variant + belgilar + jami — **bitta `GROUPING SETS` soʻrovi**; filtr tanlanmagan boʻlsa jami shu yerdan | 6 soʻrov → 2 (≈ 600 → 210 ms) |
| 3 | `V110` — `stock_balance (warehouse_id, product_id)` indeksi | 27 ms → 0,16 ms har qatorda |
| 4 | Direktor bosh sahifasi (barcha filiallar): filiallar kesimidagi qarz — bitta soʻrovdan (`summaryByBranch`) | 10 soʻrov → 2 |
| 5 | Xavfsizlik: `/api/openapi` va `/api/docs` production'da yopiladi (`YUZPLUS_API_DOCS=false`, Docker compose'da qoʻyilgan) | API tuzilmasi tashqariga koʻrinmaydi |

Natija va hisob qoidalari oʻzgarmagan: katalog — `OrderIT` (variantlar, filtr bilan jami, boʻsh natija), qarz — mavjud
hisobot testlari (bosh sahifa xulosalari endi aynan bir xil FIFO qarz yoshidan).

## 2-oʻlchov (tuzatishlardan keyin, xuddi shu ssenariy)

| Koʻrsatkich | Oldin | Keyin |
|---|---|---|
| Oʻtkazish qobiliyati | 14,4 soʻrov/s | **28,9 soʻrov/s** (×2) |
| 50 foydalanuvchi: median / p95 | 2,4 s / 5,2 s | **0,64 s / 2,2 s** |
| 150: median / p95 | 8,4 s / 18 s | 3,7 s / 8,2 s |
| 300: median / p95 | 18,8 s / 36 s | 8,5 s / 17,5 s |
| Yaratilgan / topshirilgan buyurtma (8 daqiqa) | 438 / 374 | 1 040 / 1 008 |
| Hikari kutish → 500 xato | bor (30 s) | yoʻq |
| Deadlock, qulf kutish > 200 ms | 0 / 1 | 0 / 0 |

Qolgan xatolar (~1,7 %, barcha oʻlchovlarda bir xil) — ssenariy/rol bilan bogʻliq 4xx (keyingi oʻlchovda namunasi chiqariladi),
yuklama bilan bogʻliq emas.

## Xulosa: qancha foydalanuvchi

- Sinovdagi «foydalanuvchi» har 3–8 soniyada amal bajaradi (katalog, buyurtma, hisobot) — bu oddiy ish tezligidan
  ~5 marta zich (odatda xodim 20–60 s da bitta amal). Shuning uchun **50 sinov foydalanuvchisi ≈ 150–250 haqiqiy xodim**.
- Bitta mashinada (backend + PostgreSQL + yuklama generatori) tuzatishlardan keyin 50 sinov foydalanuvchisida median 0,6 s —
  **egasining taxminiy hajmi (150 xodim, 4 filial, kuniga 1 500 buyurtma) uchun yetarli**, zaxira bilan.
- Toʻyinish nuqtasi — **PostgreSQL CPU'si** (Java emas: xato/oqim muammosi yoʻq). 150+ juda faol foydalanuvchida javob 3–8 s ga
  oʻsadi — bunday yuklama kutilmaydi, lekin oʻsish uchun keyingi qadamlar quyida.

## Tavsiyalar (server)

| Komponent | Minimal | Tavsiya | Izoh |
|---|---|---|---|
| PostgreSQL | 2 vCPU, 4 GB | **4 vCPU, 8 GB**, SSD | `shared_buffers` ≈ 25 % RAM; asosiy yuk shu yerda |
| Backend (Java) | 1 vCPU, 1,5 GB | 2 vCPU, 2 GB (`mem_limit: 2g` — hozirgidek) | heap ≈ 75 % |
| Frontend (Next.js) | 0,5 vCPU, 512 MB | 1 vCPU, 1 GB | |
| Hikari ulanishlar | 10 (standart) | 10–20 | DB CPU soniga ×2–4; koʻpaytirish CPU yetmasa foyda bermaydi |

## Keyingi optimallashtirish (kerak boʻlsa, xavf — past)

1. **Katalog qoldiq agregati** (omborning barcha partiyalari) har ochilishda 2 marta (variantlar + sahifa) — ~350 ms yuklamada.
   Variant: bitta soʻrov (umumiy CTE) yoki faqat qidiruvga mos mahsulotlar boʻyicha agregat.
2. **Qarz yoshi** (`party_doc_balance` ochiq hujjatlari) bosh sahifalarda har ochilishda — 1 daqiqalik kesh yoki SQL'da hisoblash
   (avans FIFO qoidasi saqlangan holda). Kesh — maʼlumot 1 daqiqagacha eskirishi mumkin, shuning uchun egasi qarori bilan.
3. «Mijozlar qarzi» hisobotida har mijoz uchun oxirgi toʻlov / operator / zona ichki soʻrovlari — bitta JOIN ga.
4. Qoldiqlar roʻyxati jami (`count + sum`) va Direktor bosh sahifasidagi ombor qiymati — har safar butun `stock_balance`.
