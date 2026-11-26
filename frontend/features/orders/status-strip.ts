/** U5: tayyor koʻrinishlar — «Mening», «Bugun», «Kechikkanlar» (foydalanuvchi oʻzinikini «Koʻrinishlar»da saqlaydi). */
export const QUICK_VIEWS = ["mine", "today", "overdue"] as const;
export type QuickView = (typeof QUICK_VIEWS)[number];

interface QuickFilters {
  mine: boolean;
  overdue: boolean;
  orderFrom: string | null;
  orderTo: string | null;
}

export function quickOn(v: QuickView, f: QuickFilters, today: string): boolean {
  if (v === "mine") return f.mine;
  if (v === "overdue") return f.overdue;
  return f.orderFrom === today && f.orderTo === today;
}

/** Bosilganda: yoqiladi yoki (yoqilgan boʻlsa) oʻchiriladi. */
export function quickPatch(v: QuickView, on: boolean, today: string): Partial<QuickFilters> {
  if (v === "mine") return { mine: !on };
  if (v === "overdue") return { overdue: !on };
  return on ? { orderFrom: null, orderTo: null } : { orderFrom: today, orderTo: today };
}
