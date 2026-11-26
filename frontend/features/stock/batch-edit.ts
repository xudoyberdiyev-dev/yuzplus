/** BG1 B1: partiya tahrirlash formasi tekshiruvi (sof funksiya). */
export interface BatchEditForm {
  number: string;
  /** KK.OO.YYYY yoki boʻsh */
  produced: string;
  expiry: string;
  reason: string;
}

export type BatchEditError = "required" | "date" | "producedAfter" | "nothing" | "long";

export function validateBatchEdit(
  f: BatchEditForm,
  current: { number: string; producedOn?: string | null; expiryDate: string },
  parse: (s: string) => string | undefined | null,
): Partial<Record<keyof BatchEditForm, BatchEditError>> {
  const e: Partial<Record<keyof BatchEditForm, BatchEditError>> = {};
  const number = f.number.trim();
  if (!number) e.number = "required";
  else if (number.length > 64) e.number = "long";
  const produced = f.produced.trim() ? parse(f.produced) : undefined;
  if (f.produced.trim() && !produced) e.produced = "date";
  const expiry = parse(f.expiry);
  if (!f.expiry.trim()) e.expiry = "required";
  else if (!expiry) e.expiry = "date";
  if (produced && expiry && produced > expiry) e.produced = "producedAfter";
  if (!f.reason.trim()) e.reason = "required";
  else if (f.reason.trim().length > 300) e.reason = "long";
  if (
    !e.number &&
    !e.expiry &&
    !e.produced &&
    number === current.number &&
    (produced ?? null) === (current.producedOn ?? null) &&
    expiry === current.expiryDate
  ) {
    e.number = "nothing";
  }
  return e;
}
