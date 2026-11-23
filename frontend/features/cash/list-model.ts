import { fromCents, toCents } from "./api";

/** Kassa roʻyxati (prototip Cash.dc.html → isList): karta holati va «Haydovchilardan kutilayotgan pul». Pul — tiyinlarda, float yoʻq. */

export type DayBadgeKind = "closed" | "notClosed" | "open";

/** ISO sanadan bir kun oldin (`2026-10-04` → `2026-10-03`). */
export function prevIsoDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) - 1));
  return t.toISOString().slice(0, 10);
}

/**
 * Kassa kartasidagi belgi: bugun yopilgan → «Kun yopilgan {bugun}»; kecha ham yopilmagan → «{kecha} yopilmagan»;
 * aks holda «Kun ochiq». Sana — ISO.
 */
export function dayBadge(closedThrough: string | null | undefined, today: string): { kind: DayBadgeKind; date: string } {
  const yesterday = prevIsoDay(today);
  if (closedThrough && closedThrough >= today) return { kind: "closed", date: today };
  if (!closedThrough || closedThrough < yesterday) return { kind: "notClosed", date: yesterday };
  return { kind: "open", date: today };
}

/** Kanonik pul satrlari yigʻindisi («1250000.00»). */
export function sumMoney(values: readonly string[]): string {
  return fromCents(values.reduce((a, v) => a + toCents(v), 0n));
}

export interface DriverCashLike {
  stopId: number;
  tripId: number;
  tripNumber: string;
  tripStatus: string;
  driver: string;
  orderNumber: string;
  customer: string;
  amount: string;
}

export interface DriverTrip<T extends DriverCashLike> {
  tripId: number;
  tripNumber: string;
  tripStatus: T["tripStatus"];
  driver: string;
  total: string;
  rows: T[];
}

/** Reys boʻyicha guruhlash (kelish tartibi saqlanadi). */
export function groupTrips<T extends DriverCashLike>(list: readonly T[]): DriverTrip<T>[] {
  const by = new Map<number, T[]>();
  for (const x of list) by.set(x.tripId, [...(by.get(x.tripId) ?? []), x]);
  return [...by.values()].map((rows) => {
    const first = rows[0] as T;
    return {
      tripId: first.tripId,
      tripNumber: first.tripNumber,
      tripStatus: first.tripStatus,
      driver: first.driver,
      total: sumMoney(rows.map((r) => r.amount)),
      rows,
    };
  });
}

/** Topshirilgan − kutilgan (kanonik satr); summa kiritilmagan boʻlsa — null. */
export function handoverDiff(got: string, expected: string): string | null {
  if (!/^\d+(\.\d+)?$/.test(got.trim())) return null;
  return fromCents(toCents(got) - toCents(expected));
}

/** KT1: kam topshirilgan naqd sababi — (a) mijoz toʻlamagan, (b) haydovchi kamomadi, yoki aralash. */
export type ShortReason = "customer" | "driver" | "mixed";

export type SplitError = "row" | "sum" | "mixed";

export interface ShortSplit {
  unpaid: { stopId: number; amount: string }[];
  shortage: string;
  error: SplitError | null;
}

/**
 * Kamomad taqsimoti (SPEC 5.4): `deficit` — musbat kanonik satr. «customer» — bekatlar boʻyicha toʻlanmagan summalar yigʻindisi = kamomad;
 * «driver» — butun kamomad haydovchida; «mixed» — bekatlar yigʻindisi 0 dan katta va kamomaddan kichik, qolgani haydovchida.
 * `inputs` — bekat → kiritilgan summa (kanonik satr yoki boʻsh).
 */
export function shortSplit(
  deficit: string,
  reason: ShortReason,
  rows: readonly { stopId: number; amount: string }[],
  inputs: Readonly<Record<number, string>>,
): ShortSplit {
  const total = toCents(deficit);
  if (reason === "driver") return { unpaid: [], shortage: fromCents(total), error: null };
  const unpaid: { stopId: number; amount: string }[] = [];
  let sum = 0n;
  let rowError = false;
  for (const r of rows) {
    const raw = (inputs[r.stopId] ?? "").trim();
    if (!raw) continue;
    if (!/^\d+(\.\d+)?$/.test(raw)) {
      rowError = true;
      continue;
    }
    const c = toCents(raw);
    if (c === 0n) continue;
    if (c > toCents(r.amount)) rowError = true;
    unpaid.push({ stopId: r.stopId, amount: fromCents(c) });
    sum += c;
  }
  const rest = total - sum;
  const shortage = fromCents(reason === "mixed" && rest > 0n ? rest : 0n);
  if (rowError) return { unpaid, shortage, error: "row" };
  if (reason === "customer" && rest !== 0n) return { unpaid, shortage, error: "sum" };
  if (reason === "mixed" && (sum === 0n || rest <= 0n)) return { unpaid, shortage, error: "mixed" };
  return { unpaid, shortage, error: null };
}
