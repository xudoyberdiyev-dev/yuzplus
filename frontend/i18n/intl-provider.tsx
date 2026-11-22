"use client";

import type { ReactNode } from "react";
import type { Locale } from "./config";
import { IntlShell } from "./intl-shell";
import { MESSAGES } from "./messages";

/**
 * Uch til lugʻati birga — faqat testlar uchun (`test/render.tsx`).
 * Ilovada `LocaleProvider` → `IntlLoader` faqat tanlangan til lugʻatini yuklaydi.
 */
export function IntlProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return (
    <IntlShell locale={locale} messages={MESSAGES[locale]}>
      {children}
    </IntlShell>
  );
}
