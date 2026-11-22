"use client";

import type { ReactNode } from "react";
import { uzCyrl } from "./dict/uz-Cyrl.generated";
import { IntlShell } from "./intl-shell";

/** «uz-Cyrl» lugʻati — alohida bundle boʻlagi (`intl-dynamic.tsx`). */
export default function IntlUzCyrl({ children }: { children: ReactNode }) {
  return (
    <IntlShell locale="uz-Cyrl" messages={uzCyrl}>
      {children}
    </IntlShell>
  );
}
