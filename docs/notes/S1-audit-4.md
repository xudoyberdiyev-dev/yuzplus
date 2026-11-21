# S1 audit — 4-qism: production tayyorgarligi (22.11.2026, tungi oyna, 3-sessiya)

Egasi uchun umumiy hisobot (Docs): https://claude.ai/artifact/FhqW2EKJFdkXUqKdD9oehS

## Tuzatildi

| # | Topilma | Xavf | Tuzatish |
|---|---|---|---|
| 1 | Excel importi (7 joy: mahsulotlar ×2, markirovka kodlari, SmartUp koʻchirish, boshlangʻich qoldiq, referent narxlar, narx oʻrnatish) faylni POI bilan **toʻliq xotiraga** oʻqiydi. 20 MB siqilgan .xlsx ichida yuzlab MB XML (2 mln qatorli varaq yoki «zip bomba») boʻlishi mumkin — POI ning standart chegarasi 100× (2 GB gacha). Bitta shunday yuklash backend heap'ini (1,5 GB) tugatib, **hamma uchun** xizmatni toʻxtatadi. | yuqori (tasodifan ham boʻlishi mumkin) | `shared.excel.ExcelUploadGuard`: ochilgan hajm haqiqiy ochib sanaladi (≤ 100 MB, ≤ 2 000 zip yozuvi), oshsa — «Fayl juda katta… qismlarga boʻlib yuklang» (`import.tooLarge`, 3 til). Haqiqiy importlar (≤ 20 000 qator) chegaradan ancha kichik. `ExcelUploadGuardTest`. |
| 2 | `/actuator` (indeks va boshqa ochiq endpointlar, health/info dan tashqari) — har qanday kirgan foydalanuvchiga (Haydovchi ham) ochiq edi. Docker deployda Caddy tashqariga chiqarmaydi, lekin Railway'da backend toʻgʻridan-toʻgʻri ochiq. | past | faqat `settings.security` ruxsati bilan (`SecurityConfig`), `EndpointPermissionsIT` ga qoʻshildi. |

## Tekshirildi — muammo yoʻq

- Frontend bogʻliqliklari: `pnpm audit --prod` — zaiflik yoʻq (dev: 1 moderate, `minimatch` ReDoS — faqat build vositasida).
- Mobil: 3 moderate (`minimatch` ← `@expo/fingerprint` ← `expo`) — build vositasi, ilova ichida ishlamaydi; tuzatish Expo'ni orqaga tushirishni talab qiladi → qoldirildi.
- Ommaviy PDF/Excel: 50 buyurtma (faktura), 20 (terish varagʻi), 200 (mahsulot qoldigʻi) chegaralari serverda bor.
- Yuklash hajmi: `max-file-size 20MB`, hisobot eksportlari `MAX_ROWS` bilan cheklangan.
- Zaxira nusxa + tiklash sinovi workflow'i (`backup.yml`, `scripts/backup/restore-test.sh`) yozilgan.

## Egasidan kerak (production'dan oldin)

1. **Kunlik zaxira nusxa hali bir marta ham ishlamagan**: `backup.yml` faqat **private** repoda ishlaydi (ochiq repoda shifrlangan nusxa ham xavfli) — 20.11 va 21.11 dagi rejalashtirilgan ishga tushirishlar «skipped». Kerak: repo'ni private qilish + `PROD_DATABASE_URL`, `BACKUP_PASSPHRASE` sirlari (+ Railway Postgres «Backups»).
2. Backend bogʻliqliklari zaifligini skanerlash bu muhitda imkonsiz (Maven bloklangan) — GitHub'da Dependabot alerts'ni yoqish tavsiya etiladi (bepul, sozlamalar → Code security).
