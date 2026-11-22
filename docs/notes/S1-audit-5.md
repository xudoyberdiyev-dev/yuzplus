# S1 — 5-qism: frontend bundle (22.11.2026, kunduzgi oyna)

## Topilma
Ildiz layout (`i18n/intl-provider.tsx`) uch til lugʻatini (`uz-Latn`, `uz-Cyrl`, `ru` — 53 nomlar fazosi)
bitta mijoz moduli orqali ulagan edi. Natija: **har bir sahifada** (jumladan kirish sahifasi) 1,19 MB
(gzip ~311 KB) JS boʻlagi — uchala til birga; foydalanuvchi faqat bittasini ishlatadi.
Lugʻatlar oʻsib borgani sari bu boʻlak ham kattalashardi (telefon panellari, sekin mobil internet).

## Tuzatish
- `pnpm i18n:cyrl` endi har til uchun alohida modul yasaydi: `i18n/dict/<til>.generated.ts`;
  `i18n/messages.generated.ts` — ularni qayta eksport qiladi (testlar va tiplar uchun).
- `i18n/intl-loader.tsx` — tanlangan til lugʻati dinamik import bilan (`use()` + bitta promise kesh);
  har til alohida bundle boʻlagi, brauzer keshlaydi. `LocaleProvider` (server) cookie'dan tilni oʻqib uzatadi.
- `i18n/intl-shell.tsx` — umumiy `NextIntlClientProvider`; `IntlProvider` (uch til birga) faqat testlar uchun qoldi.
- Til almashtirish (`router.refresh()`) — yangi til boʻlagi yuklanadi, oʻtish (transition) davomida eski matn turadi.

## Oʻlchov (`pnpm build && pnpm start`, Playwright, `/login`, yuklangan JS jami)
| Til | Oldin | Keyin |
|---|---|---|
| uz-Latn | 1 743 KB (3 lugʻat) | 886 KB (−49%) |
| uz-Cyrl | 1 743 KB | 1 017 KB (−42%) |
| ru | 1 743 KB | 1 025 KB (−41%) |

Lugʻat boʻlaklari: uz-Latn 301 KB, uz-Cyrl 435 KB, ru 443 KB (siqilgan ~89–108 KB).
Tekshiruv: `<html lang>` va matn har tilda toʻgʻri, til almashtirish (kirish sahifasi → Русский) ishlaydi,
sahifa xatolari yoʻq; frontend 625 unit, lint, typecheck, format — yashil.

## Qolgan eng katta boʻlaklar
React DOM (229 KB), Next router (164 KB), polyfill (113 KB) — framework, kamaytirib boʻlmaydi.
Keyingi imkoniyat (shart emas): lugʻatni nomlar fazosi boʻyicha sahifalarga boʻlish (hozir bitta til ~300–440 KB) —
murakkablik oshadi, foyda ~100 KB siqilgan; hozircha kerak emas.

## N+1 koʻrigi (backend, statik)
Skript bilan sikl (`for`/`forEach`) ichidagi `jdbc.sql(...)` chaqiruvlari qidirildi — 123 joy.
- **Deyarli hammasi — hujjat oʻtkazishdagi qator yozuvlari** (sotuv/kirim/koʻchirish qatorlari, zahira, jurnal):
  hujjat qatorlari soni bilan chegaralangan (odatda 5–100), bitta tranzaksiyada; yuklama sinovi (3-qism) bu yoʻlda
  muammo koʻrsatmadi. Ommaviy `batchUpdate` ga oʻtkazish — kelajakdagi kichik yutuq (~10–40 ms / 100 qator), hozir shart emas.
- **Oʻqish yoʻlida topildi va tuzatildi:** mijoz/YB kartochkasi (`CounterpartyOverview.summary`) har filial uchun
  `DebtSummaries.byParty` — filialdagi **barcha** kontragentlarning qarz yoshini hisoblab, bittasini olardi
  (5 000 mijoz × 4 filialda — har kartochka ochilishida ~4 ta toʻliq skan). Endi `DebtSummaries.ofParty` —
  `party_doc_balance` dan faqat shu kontragent (`party_doc_balance_open_idx` indeksi). IT: shu filialdagi boshqa
  mijoz qarzi kartochkaga aralashmaydi (`CounterpartyOverviewIT`).
- Qolgan oʻqish sikllari (audit yorligʻi — tur boʻyicha `IN (...)`, qarz tafsiloti — filial boʻyicha) — filial/tur soni bilan
  chegaralangan, muammo emas.
