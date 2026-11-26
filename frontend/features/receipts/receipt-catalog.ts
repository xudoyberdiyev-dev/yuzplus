import { parseMoneyInput, parseUzDate } from "@/features/counterparties/api";

/** Katalog qatoriga kiritilgan qiymatlar (hammasi matn, KK.OO.YYYY / «15.000,50» koʻrinishida). */
export interface CatalogInput {
  batch: string;
  produced: string;
  expiry: string;
  qty: string;
  bonus: string;
  price: string;
}

export const EMPTY_INPUT: CatalogInput = { batch: "", produced: "", expiry: "", qty: "", bonus: "", price: "" };

export interface CatalogProduct {
  productId: number;
  code: string;
  name: string;
  lastPrice?: string | null;
}

/** Kirim qoralamasiga qoʻshiladigan qator (receipt-drawer DraftLine bilan bir xil maydonlar). */
export interface CatalogPick {
  productId: number;
  productCode: string;
  productName: string;
  batchNumber: string;
  producedOn: string;
  expiryDate: string;
  zoneId: number;
  qty: string;
  bonusQty: string;
  price: string;
}

/** Katalog qatoridagi xato — `receipts.catalog.errors.<kalit>` (tarjima komponentda). */
export type CatalogError = "batch" | "expiry" | "produced" | "qty" | "bonus" | "price" | "duplicate" | "zone";

const isInt = (s: string) => /^\d+$/.test(s.trim());

/** BG1 B3: bir mahsulotga bir nechta partiya — kiritish kaliti: 0-partiya `"<id>"`, keyingilari `"<id>:<n>"`. */
export function slotKey(productId: number, slot: number): string {
  return slot === 0 ? String(productId) : `${productId}:${slot}`;
}

/** Mahsulotning kiritish kalitlari (partiya tartibida). */
export function productSlots(productId: number, inputs: Record<string, CatalogInput>): string[] {
  const id = String(productId);
  return Object.keys(inputs)
    .filter((k) => k === id || k.startsWith(`${id}:`))
    .sort((a, b) => Number(a.split(":")[1] ?? 0) - Number(b.split(":")[1] ?? 0));
}

/**
 * Katalogdagi toʻldirilgan qatorlarni tekshiradi: biror maydoni toʻldirilgan qator toʻliq boʻlishi shart (partiya, yaroqlilik,
 * soni). Narx boʻsh boʻlsa — shu YB dan oxirgi narx (bor boʻlsa). Bir xil mahsulot + partiya qoralamada yoki shu katalogda
 * ikki marta boʻlsa — xato. Xatolar kiritish kaliti boʻyicha (`slotKey`).
 */
export function collectPicks(
  rows: CatalogProduct[],
  inputs: Record<string, CatalogInput>,
  opts: { zoneId: number | null; pricesVisible: boolean; existing: Set<string> },
): { picks: CatalogPick[]; errors: Record<string, CatalogError> } {
  const picks: CatalogPick[] = [];
  const errors: Record<string, CatalogError> = {};
  const seen = new Set(opts.existing);
  for (const r of rows) {
    for (const key of productSlots(r.productId, inputs)) {
      const v = inputs[key];
      if (!v || Object.values(v).every((x) => !x.trim())) continue;
      const fail = (m: CatalogError) => (errors[key] = m);
      const dup = `${r.productId}|${v.batch.trim().toUpperCase()}`;
      if (!v.batch.trim()) fail("batch");
      else if (!parseUzDate(v.expiry)) fail("expiry");
      else if (v.produced.trim() && !parseUzDate(v.produced)) fail("produced");
      else if (!isInt(v.qty) || Number(v.qty) < 1) fail("qty");
      else if (v.bonus.trim() && !isInt(v.bonus)) fail("bonus");
      else if (opts.pricesVisible && v.price.trim() && !parseMoneyInput(v.price)) fail("price");
      else if (seen.has(dup)) fail("duplicate");
      else if (opts.zoneId === null) fail("zone");
      if (errors[key] || opts.zoneId === null) continue;
      seen.add(dup);
      const price = opts.pricesVisible ? (parseMoneyInput(v.price) ?? r.lastPrice ?? "") : "";
      picks.push({
        productId: r.productId,
        productCode: r.code,
        productName: r.name,
        batchNumber: v.batch.trim(),
        producedOn: v.produced.trim(),
        expiryDate: v.expiry.trim(),
        zoneId: opts.zoneId,
        qty: v.qty.trim(),
        bonusQty: v.bonus.trim(),
        price,
      });
    }
  }
  return { picks, errors };
}
