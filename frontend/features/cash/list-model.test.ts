import { describe, expect, it } from "vitest";
import { dayBadge, groupTrips, handoverDiff, prevIsoDay, shortSplit, sumMoney } from "./list-model";

const row = (stopId: number, tripId: number, amount: string) => ({
  stopId,
  tripId,
  tripNumber: `RS-TSH-${tripId}`,
  tripStatus: "DONE",
  driver: "Anvar",
  orderNumber: `BY-${stopId}`,
  customer: "Farm Lux",
  amount,
});

describe("kassa roʻyxati", () => {
  it("oldingi kun (oy va yil chegarasi)", () => {
    expect(prevIsoDay("2026-10-04")).toBe("2026-10-03");
    expect(prevIsoDay("2026-03-01")).toBe("2026-02-28");
    expect(prevIsoDay("2027-01-01")).toBe("2026-12-31");
  });

  it("kartadagi kun holati", () => {
    expect(dayBadge("2026-10-04", "2026-10-04")).toEqual({ kind: "closed", date: "2026-10-04" });
    expect(dayBadge("2026-10-03", "2026-10-04")).toEqual({ kind: "open", date: "2026-10-04" });
    expect(dayBadge("2026-10-01", "2026-10-04")).toEqual({ kind: "notClosed", date: "2026-10-03" });
    expect(dayBadge(null, "2026-10-04")).toEqual({ kind: "notClosed", date: "2026-10-03" });
  });

  it("pul yigʻindisi tiyinlarda", () => {
    expect(sumMoney(["0.10", "0.20"])).toBe("0.30");
    expect(sumMoney([])).toBe("0.00");
  });

  it("haydovchidagi pul reys boʻyicha", () => {
    const g = groupTrips([row(1, 7, "100000.50"), row(2, 8, "5000"), row(3, 7, "200000")]);
    expect(g.map((t) => [t.tripId, t.total, t.rows.length])).toEqual([
      [7, "300000.50", 2],
      [8, "5000.00", 1],
    ]);
  });

  it("topshirilgan summa farqi", () => {
    expect(handoverDiff("300000.50", "300000.50")).toBe("0.00");
    expect(handoverDiff("299000", "300000.50")).toBe("-1000.50");
    expect(handoverDiff("", "1")).toBeNull();
  });
});

describe("KT1: kamomad taqsimoti", () => {
  const rows = [
    { stopId: 1, amount: "2000.00" },
    { stopId: 2, amount: "2000.00" },
  ];
  it("haydovchi kamomadi — butun farq", () => {
    expect(shortSplit("1500.00", "driver", rows, { 1: "100" })).toEqual({ unpaid: [], shortage: "1500.00", error: null });
  });
  it("mijoz toʻlamagan — yigʻindi kamomadga teng boʻlishi kerak", () => {
    expect(shortSplit("1500.00", "customer", rows, { 1: "1000", 2: "500" })).toEqual({
      unpaid: [
        { stopId: 1, amount: "1000.00" },
        { stopId: 2, amount: "500.00" },
      ],
      shortage: "0.00",
      error: null,
    });
    expect(shortSplit("1500.00", "customer", rows, { 1: "1000" }).error).toBe("sum");
    expect(shortSplit("1500.00", "customer", rows, { 1: "2500" }).error).toBe("row");
    expect(shortSplit("1500.00", "customer", rows, { 1: "abc" }).error).toBe("row");
  });
  it("aralash — qolgani haydovchida", () => {
    expect(shortSplit("1500.00", "mixed", rows, { 1: "1000" })).toEqual({
      unpaid: [{ stopId: 1, amount: "1000.00" }],
      shortage: "500.00",
      error: null,
    });
    expect(shortSplit("1500.00", "mixed", rows, {}).error).toBe("mixed");
    expect(shortSplit("1500.00", "mixed", rows, { 1: "1500" }).error).toBe("mixed");
  });
});
