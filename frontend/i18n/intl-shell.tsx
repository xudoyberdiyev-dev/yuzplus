"use client";

import { NextIntlClientProvider } from "next-intl";
import { useEffect, type ReactNode } from "react";
import { TIME_ZONE, type Locale } from "./config";
import type { uzLatn } from "./messages.generated";

/** Tarjimalar konteksti — lugʻat tashqaridan keladi (serverdan — `locale-provider.tsx`). */
export function IntlShell({ locale, messages, children }: { locale: Locale; messages: typeof uzLatn; children: ReactNode }) {
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  return (
    <NextIntlClientProvider locale={locale} messages={messages} timeZone={TIME_ZONE}>
      {children}
    </NextIntlClientProvider>
  );
}
