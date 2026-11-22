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
