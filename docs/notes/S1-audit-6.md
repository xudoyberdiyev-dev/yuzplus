# S1 — texnik audit, 6-qism (23.11.2026 tungi oyna): zaxira nusxa, oʻsish, production kuzatuvi

## Sinov muhiti
Mahalliy PostgreSQL 16 (2 CPU, 7 GB RAM), `scripts/s1/run.sh 730 1500 15 10` — **2 yillik** sintetik hajm (generator 11,5 daq).
Diqqat: mahalliy bazada `fsync=off` — production diskida tiklash sekinroq boʻladi (taxminan 1,5–2×).

## 1. Hajm va oʻsish (2 yil)
| Jadval | Qator | Jadval | Indeks | Jami |
|---|---|---|---|---|
| stock_move | 19,3 mln | 2,4 GB | 1,7 GB | 4,2 GB |
| sales_order_line | 16,4 mln | 1,5 GB | 1,6 GB | 3,1 GB |
| sale_line | 16,1 mln | 1,7 GB | 1,1 GB | 2,8 GB |
| sales_order_mark | 5,5 mln | 0,95 GB | 0,6 GB | 1,6 GB |
| sales_order | 1,1 mln | 0,2 GB | 0,44 GB | 0,64 GB |
| party_ledger | 2,1 mln | 0,25 GB | 0,26 GB | 0,52 GB |
| sale | 1,1 mln | 0,17 GB | 0,27 GB | 0,44 GB |
| **Baza jami** | | | | **13 GB** (+ audit ~1–2 GB) |

- Oʻsish chiziqli: **~6,5–7 GB / yil** → 4 yilda ~27–30 GB. Railway disk hajmi shunga yetadigan boʻlsin.
- **Partitsiya — hozir kerak emas.** Barcha tez-tez ishlatiladigan soʻrovlar indeks bilan (2-qism), eng katta jadval 4 yilda
  ~8 GB / 40 mln qator — PostgreSQL uchun oddiy hajm. Qayta koʻrish nuqtasi: `stock_move` > 80–100 mln qator (~8–10 yil)
  yoki jadval > 30 GB. Oʻshanda oy boʻyicha partitsiya (`stock_move`, `sale_line`, `sales_order_line`) — append-only jurnal
  boʻlgani uchun oson.
- **Arxiv siyosati:** moliyaviy va ombor jurnallari oʻchirilmaydi (SPEC). Oʻsadigan, lekin biznes maʼlumoti boʻlmagan jadval —
  `notification`: tozalash yoʻq (taxminan 0,5–1 mln yozuv/yil). Ishlashga taʼsiri yoʻq (indeks `employee_id, created_at`),
  faqat disk. Tozalash (masalan, oʻqilgan va 180 kundan eski) — production maʼlumotini oʻchirish → **egasi qarori** (savollarda).
  `system_error` — allaqachon tozalanadi.

## 2. Zaxira nusxa va tiklash (2 yillik hajm)
| Qadam | Natija |
|---|---|
| `pg_dump --format=custom` (standart siqish) | **84 s**, fayl **0,95 GB** (bazaning ~7%) |
| `pg_restore` ketma-ket (hozirgi `restore-test.sh`) | **273 s** |
| `pg_restore -j 2` | **193 s** (−29%; runnerda 4 CPU — yanada tez) |

- **Tiklash vaqti (RTO):** 2 yillik bazada ~5–10 daqiqa (disk + tarmoq bilan), 4 yilda ~10–20 daqiqa.
- Tuzatildi: `restore-test.sh` — `pg_restore -j "$(nproc)"` va vaqt chiqariladi; `backup.yml` — `timeout-minutes` 30 → 60
  (pg_dump tarmoq orqali + gpg + tiklash sinovi 4 yillik hajmda 30 daqiqaga sigʻmasligi mumkin edi).
- **⚠️ Muhim (egasi uchun):** zaxira nusxa GitHub Actions artefaktida 14 kun saqlanadi. GitHub Free tarifida private repo
  uchun **Actions xotirasi 500 MB** va **2 000 daqiqa/oy** ([GitHub Docs](https://docs.github.com/en/billing/reference/product-usage-included)).
  - Hozir production bazasi kichik — muammo yoʻq. Lekin ~1 yildan keyin bitta nusxa ~0,5 GB, 14 kunlik — ~7 GB → limitdan oshadi.
    Uzoq muddatli yechim: Railway Postgres «Backups» (asosiy) + tashqi saqlash (S3/R2 — pullik, egasi qarori) yoki
    saqlash muddatini qisqartirish.
  - **Repo private qilinsa CI ham pullik daqiqalarga tushadi:** bitta toʻliq CI ≈ 21 daqiqa (backend 4 + frontend 3 + E2E 14),
    kuniga taxminan 20–60 CI ishga tushirish (zanjir sessiyalari) → 400–1 200 daqiqa/kun → bepul 2 000 daqiqa **2–5 kunda** tugaydi. Variantlar (egasi qarori): repo public
    qoladi va zaxira boshqa joyga; yoki private + pullik daqiqalar; yoki private + CI faqat PR/kechki birlashtirishda.

## 3. Production kuzatuvi — sekin soʻrovlar logi
- Yangi: `shared.web.SlowRequestLog` — 1 s dan uzoq davom etgan har `/api/**` soʻrovi Railway logiga WARN:
  `slow-request GET /api/orders/{id} uri=/api/orders/15 status=200 ms=1530 user=operator1`.
  Soʻrov satri (qidiruv matni) yozilmaydi, SSE oqimi oʻtkaziladi. Chegara: `YUZPLUS_SLOW_REQUEST_MS` (0 — oʻchiq). `SlowRequestLogTest`.
- Railway'da «slow-request» boʻyicha filtrlash — qaysi sahifa sekinlashganini birinchi kundan koʻrsatadi.
- Qilinmadi (xavfli): PostgreSQL `log_min_duration_statement` ni ulanishda yoqish — superuser huquqi kerak, boʻlmasa ilova
  ishga tushmaydi. Egasi Railway Postgres sozlamasida yoqishi mumkin (1000 ms).
- `/actuator/prometheus` roʻyxatda bor, lekin `micrometer-registry-prometheus` bogʻliqligi yoʻq — metrika tizimi ulanmagan.
  Monitoring xizmati tanlansa (Grafana Cloud bepul tarif va h.k.) — qoʻshiladi.
