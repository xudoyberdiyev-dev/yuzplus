import type { Locale } from "./config";
import { ru, uzCyrl, uzLatn } from "./messages.generated";

/** Barcha lugʻatlar — testlar va server uchun. Brauzerga til boʻyicha alohida modul boradi (`locale-provider.tsx`). */
export const MESSAGES: Record<Locale, typeof uzLatn> = { "uz-Latn": uzLatn, "uz-Cyrl": uzCyrl, ru };
