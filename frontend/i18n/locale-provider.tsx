import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { LEGACY_LOCALE_COOKIE, LOCALE_COOKIE, resolveLocale } from "./config";
import { IntlLoader } from "./intl-loader";

/**
 * Tilni cookie'dan oʻqiydi. `cacheComponents` yoqilgani uchun cookie oʻqish dinamik —
 * shu komponent root layoutda `<Suspense>` ichida turadi (Next 16: internationalization qoʻllanmasi).
 * Lugʻat — faqat tanlangan til (`IntlLoader`, alohida bundle boʻlagi).
 */
export async function LocaleProvider({ children }: { children: ReactNode }) {
  const jar = await cookies();
  const locale = resolveLocale(jar.get(LOCALE_COOKIE)?.value ?? jar.get(LEGACY_LOCALE_COOKIE)?.value);
  return <IntlLoader locale={locale}>{children}</IntlLoader>;
}
