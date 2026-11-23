"use client";

import { Wrench } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { BrandSquare } from "@/components/shell/brand-logo";

/**
 * Egasi qarori (23.11.2026 15:55): texnik ishlar vaqtida login qilingandan keyin butun ekran yopiladi,
 * foydalanuvchi ishlay olmaydi. MAINTENANCE_UNTIL dan keyin oʻzi yoʻqoladi (sahifani yangilash shart emas).
 * Keyingi safar: vaqtni oʻzgartiring yoki null qiling.
 */
export const MAINTENANCE_UNTIL: string | null = "2026-11-23T17:00:00+05:00";
const DISPLAY_TIME = "17:00";

export function isUnderMaintenance(now: number, until: string | null = MAINTENANCE_UNTIL): boolean {
  return until !== null && now < Date.parse(until);
}

export function MaintenanceOverlay() {
  const t = useTranslations("shell");
  const [active, setActive] = useState(false);

  useEffect(() => {
    // Avtomatik testlar (Playwright: navigator.webdriver) yopilmaydi.
    if (navigator.webdriver) return;
    const check = () => setActive(isUnderMaintenance(Date.now()));
    check();
    const id = window.setInterval(check, 30_000);
    return () => window.clearInterval(id);
  }, []);

  if (!active) return null;
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="maintenance-title"
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-surface p-6 print:hidden"
    >
      <div className="flex max-w-[480px] flex-col items-center gap-4 text-center">
        <BrandSquare />
        <div className="flex size-14 items-center justify-center rounded-full bg-warning-bg text-warning">
          <Wrench size={28} strokeWidth={1.5} aria-hidden />
        </div>
        <h1 id="maintenance-title" className="text-xl font-semibold text-text-primary">
          {t("maintenanceTitle")}
        </h1>
        <p className="text-text-secondary">{t("maintenanceText", { time: DISPLAY_TIME })}</p>
      </div>
    </div>
  );
}
