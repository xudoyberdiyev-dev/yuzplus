"use client";

import { use, type ReactNode } from "react";
import type { Locale } from "./config";
import { IntlShell } from "./intl-shell";
import type { uzLatn } from "./messages.generated";

type Dictionary = typeof uzLatn;

/**
 * Har til lugʻati — alohida bundle boʻlagi (dinamik import). Brauzer faqat tanlangan tilni yuklaydi
 * va keshlaydi: uch til birga ~1,2 MB edi (S1 5-qism).
 */
const LOADERS: Record<Locale, () => Promise<Dictionary>> = {
  "uz-Latn": () => import("./dict/uz-Latn.generated").then((m) => m.uzLatn),
  "uz-Cyrl": () => import("./dict/uz-Cyrl.generated").then((m) => m.uzCyrl),
  ru: () => import("./dict/ru.generated").then((m) => m.ru),
};

const loaded = new Map<Locale, Promise<Dictionary>>();

/** Bir til uchun bitta va oʻsha promise (`use` qayta renderda qayta yuklamasin). */
export function loadDictionary(locale: Locale): Promise<Dictionary> {
  let promise = loaded.get(locale);
  if (!promise) {
    promise = LOADERS[locale]();
    loaded.set(locale, promise);
  }
  return promise;
}

/** Tanlangan til lugʻatini yuklab, tarjima kontekstini ulaydi. Yuklanguncha yuqoridagi `<Suspense>` kutadi. */
export function IntlLoader({ locale, children }: { locale: Locale; children: ReactNode }) {
  const messages = use(loadDictionary(locale));
  return (
    <IntlShell locale={locale} messages={messages}>
      {children}
    </IntlShell>
  );
}
