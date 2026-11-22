"use client";

import type { ReactNode } from "react";
import { uzLatn } from "./dict/uz-Latn.generated";
import { IntlShell } from "./intl-shell";

/** «uz-Latn» lugʻati — alohida bundle boʻlagi (`intl-dynamic.tsx`). */
export default function IntlUzLatn({ children }: { children: ReactNode }) {
  return (
    <IntlShell locale="uz-Latn" messages={uzLatn}>
      {children}
    </IntlShell>
  );
}
