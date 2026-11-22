"use client";

import type { ReactNode } from "react";
import { ru } from "./dict/ru.generated";
import { IntlShell } from "./intl-shell";

/** «ru» lugʻati — alohida bundle boʻlagi (`intl-dynamic.tsx`). */
export default function IntlRu({ children }: { children: ReactNode }) {
  return (
    <IntlShell locale="ru" messages={ru}>
      {children}
    </IntlShell>
  );
}
