import type { components } from "@/lib/api/schema";

/**
 * FT (egasi 24.11.2026): faktura tahriri — ustunlarni yashirish (FT1), qatorlarni olib tashlash (FT2), boʻlimlar (FT3), qoʻshilgan ustunlar
 * (FT4). Hammasi faqat faylga taʼsir qiladi. Sof funksiyalar — oyna va testlar uchun.
 */
export type FormRow = components["schemas"]["FormRow"];
export type ExtraColumn = components["schemas"]["ExtraColumn"];

/** Tahrir holati: qatorlar (boʻlim sarlavhalari bilan), qoʻshilgan ustunlar, faktura turi → yashirin ustunlar. */
export interface InvoiceDoc {
  rows: FormRow[];
  extraColumns: ExtraColumn[];
  hidden: Record<string, string[]>;
}

export const MAX_EXTRA_COLUMNS = 10;

export function isSection(r: FormRow): boolean {
  return r.kind === "SECTION";
}

export function isRemoved(r: FormRow): boolean {
  return !isSection(r) && r.removed === true;
}

export function sectionRow(title: string): FormRow {
  return { name: title, qty: 0, kind: "SECTION" };
}

/** Pul satri → tiyin (float xatosisiz). */
export function cents(v: string | null | undefined): bigint {
  if (!v || !/^\d+(\.\d{1,2})?$/.test(v)) return 0n;
  const [i, f = ""] = v.split(".");
  return BigInt(i) * 100n + BigInt((f + "00").slice(0, 2));
}

export function centsText(c: bigint): string {
  return `${(c / 100n).toString()}.${(c % 100n).toString().padStart(2, "0")}`;
}

/** Oynadagi koʻrinish qatori: boʻlim sarlavhasi, mahsulot qatori (№ bilan), «Boʻlim jami». Olib tashlanganlar — alohida roʻyxatda. */
export type ViewLine =
  | { kind: "section"; index: number; title: string; count: number }
  | { kind: "row"; index: number; no: number; item: number }
  | { kind: "subtotal"; section: number; qty: number; sum: string };

export function viewLines(rows: FormRow[], total: (r: FormRow) => string): ViewLine[] {
  const out: ViewLine[] = [];
  let no = 0;
  let item = 0;
  let open: { at: number; section: number; qty: number; sum: bigint; count: number } | null = null;
  const close = () => {
    if (!open) return;
    const head = out[open.at];
    if (head.kind === "section") head.count = open.count;
    if (open.count > 0) out.push({ kind: "subtotal", section: open.section, qty: open.qty, sum: centsText(open.sum) });
    open = null;
  };
  rows.forEach((r, index) => {
    if (isSection(r)) {
      close();
      out.push({ kind: "section", index, title: r.name, count: 0 });
      open = { at: out.length - 1, section: index, qty: 0, sum: 0n, count: 0 };
      return;
    }
    const itemNo = item++;
    if (isRemoved(r)) return;
    out.push({ kind: "row", index, no: ++no, item: itemNo });
    if (open) {
      open.count++;
      open.qty += r.qty;
      open.sum += cents(total(r));
    }
  });
  close();
  return out;
}

/** Faylga chiqadigan jami (olib tashlanganlar va boʻlim sarlavhalarisiz). */
export function grandTotal(rows: FormRow[], total: (r: FormRow) => string): { qty: number; sum: string } {
  let qty = 0;
  let sum = 0n;
  for (const r of rows) {
    if (isSection(r) || isRemoved(r)) continue;
    qty += r.qty;
    sum += cents(total(r));
  }
  return { qty, sum: centsText(sum) };
}

/** FT2: tanlangan qatorlarni olib tashlash / qaytarish. */
export function setRemoved(rows: FormRow[], indexes: Iterable<number>, removed: boolean): FormRow[] {
  const set = new Set(indexes);
  return rows.map((r, i) => (set.has(i) && !isSection(r) ? { ...r, removed: removed ? true : undefined } : r));
}

/** FT2 «Nusxa»: har tanlangan qatorning nusxasi oʻzidan keyin. */
export function duplicate(rows: FormRow[], indexes: Iterable<number>): FormRow[] {
  const set = new Set(indexes);
  return rows.flatMap((r, i) => (set.has(i) && !isSection(r) ? [r, { ...r, extra: r.extra ? { ...r.extra } : undefined }] : [r]));
}

/** FT3 «Boʻlimga koʻchirish»: tanlangan qatorlar boʻlim oxiriga (keyingi boʻlimdan oldin). `section` — boʻlim sarlavhasi indeksi. */
export function moveToSection(rows: FormRow[], indexes: Iterable<number>, section: number): FormRow[] {
  const set = new Set([...indexes].filter((i) => i !== section && rows[i] && !isSection(rows[i])));
  if (!rows[section] || !isSection(rows[section]) || set.size === 0) return rows;
  const moving = rows.filter((_, i) => set.has(i));
  const head = rows[section];
  const rest = rows.filter((_, i) => !set.has(i));
  const at = rest.indexOf(head);
  let end = at + 1;
  while (end < rest.length && !isSection(rest[end])) end++;
  return [...rest.slice(0, end), ...moving, ...rest.slice(end)];
}

/** FT3: boʻlim qoʻshish — tanlangan qatorlar boʻlsa ular yangi boʻlimga oʻtadi, aks holda boʻsh boʻlim oxirida. */
export function addSection(rows: FormRow[], title: string, indexes: Iterable<number> = []): FormRow[] {
  const next = [...rows, sectionRow(title)];
  return moveToSection(next, indexes, next.length - 1);
}

/** FT3: boʻlimni oʻchirish — sarlavha olinadi, qatorlari yuqoridagi boʻlimga (yoki boʻlimsiz) qoladi. */
export function removeSection(rows: FormRow[], index: number): FormRow[] {
  return rows[index] && isSection(rows[index]) ? rows.filter((_, i) => i !== index) : rows;
}

/** FT4: yangi ustun kaliti x1, x2 … */
export function nextExtraKey(cols: ExtraColumn[]): string {
  const max = cols.reduce((m, c) => Math.max(m, Number(c.key.slice(1)) || 0), 0);
  return `x${max + 1}`;
}

/** FT1: turning ustunini yashirish/koʻrsatish («Махсулот номи» doim koʻrinadi). */
export function toggleHidden(hidden: Record<string, string[]>, type: string, key: string): Record<string, string[]> {
  if (key === "name") return hidden;
  const cur = hidden[type] ?? [];
  const next = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key];
  const out = { ...hidden };
  if (next.length) out[type] = next;
  else delete out[type];
  return out;
}

/** FT4: qoʻshilgan ustunni olib tashlash — kataklari va yashirish belgilari ham. */
export function removeExtraColumn(doc: InvoiceDoc, key: string): InvoiceDoc {
  const hidden: Record<string, string[]> = {};
  for (const [t, keys] of Object.entries(doc.hidden)) {
    const k = keys.filter((x) => x !== key);
    if (k.length) hidden[t] = k;
  }
  return {
    extraColumns: doc.extraColumns.filter((c) => c.key !== key),
    hidden,
    rows: doc.rows.map((r) => {
      if (!r.extra || !(key in r.extra)) return r;
      const extra = { ...r.extra };
      delete extra[key];
      return { ...r, extra: Object.keys(extra).length ? extra : undefined };
    }),
  };
}
