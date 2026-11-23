// HD2: yoʻl xarajati — sof qism (testlar bilan). Pul — tiyinda (bigint), float yoʻq.

export type ExpenseKind = "FUEL" | "MEAL" | "TOLL" | "REPAIR" | "OTHER";
export type ExpenseSource = "ADVANCE" | "OWN" | "COLLECTED";

export const EXPENSE_KINDS: readonly ExpenseKind[] = ["FUEL", "MEAL", "TOLL", "REPAIR", "OTHER"];
export const EXPENSE_SOURCES: readonly ExpenseSource[] = ["ADVANCE", "COLLECTED", "OWN"];

export type ExpenseDraft = {
  kind: ExpenseKind;
  amount: bigint;
  source: ExpenseSource;
  note: string;
  photo: string | null;
  liters: string;
  price: bigint;
  odometer: string;
};

export type DraftError = "amount" | "photo" | "note" | "liters" | "odometer";

/** Xato: summa > 0; yoqilgʻida chek rasmi majburiy; «Boshqa» — izoh majburiy; litr va spidometr — ixtiyoriy, lekin toʻgʻri son. */
export function checkDraft(d: ExpenseDraft): DraftError | null {
  if (d.amount <= 0n) return "amount";
  if (d.kind === "FUEL" && !d.photo) return "photo";
  if (d.kind === "OTHER" && !d.note.trim()) return "note";
  if (d.liters.trim() && !/^\d{1,5}([.,]\d{1,2})?$/.test(d.liters.trim())) return "liters";
  if (d.odometer.trim() && !/^\d{1,7}$/.test(d.odometer.trim())) return "odometer";
  return null;
}

/** Avans qoldigʻi: berilgan avans − avansdan qilingan xarajatlar (manfiy boʻlsa — avans yetmadi). */
export function advanceLeft(advance: bigint, expenses: readonly { amount: bigint; source: ExpenseSource; rejected: boolean }[]): bigint {
  return expenses.reduce((left, x) => (x.source === "ADVANCE" && !x.rejected ? left - x.amount : left), advance);
}

/** Boshlangʻich manba: avans qoldigʻi yetsa — avansdan, aks holda yigʻilgan naqddan. */
export function defaultSource(left: bigint, amount: bigint): ExpenseSource {
  return left > 0n && left >= amount ? "ADVANCE" : "COLLECTED";
}
