"use client";

import dynamic from "next/dynamic";
import type { ComponentType, ReactNode } from "react";
import type { Locale } from "./config";

type Props = { children: ReactNode };

/**
 * Har til lugʻati — alohida bundle boʻlagi (`next/dynamic`, SSR bilan): server render qilgan til boʻlagi
 * sahifa skriptlari bilan birga yuklanadi (hydration qoʻshimcha soʻrov kutmaydi), brauzer keshlaydi (S1 5-qism).
 */
const PROVIDERS: Record<Locale, ComponentType<Props>> = {
  "uz-Latn": dynamic(() => import("./intl-uz-latn")),
  "uz-Cyrl": dynamic(() => import("./intl-uz-cyrl")),
  ru: dynamic(() => import("./intl-ru")),
};

export function IntlDynamic({ locale, children }: Props & { locale: Locale }) {
  const Provider = PROVIDERS[locale];
  return <Provider>{children}</Provider>;
}
