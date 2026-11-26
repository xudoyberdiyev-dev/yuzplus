import { describe, expect, it } from "vitest";
import { quickOn, quickPatch } from "./status-strip";

describe("tayyor koʻrinishlar (U5)", () => {
  const base = { mine: false, overdue: false, orderFrom: null, orderTo: null };
  it("yoqish va oʻchirish", () => {
    expect(quickPatch("mine", false, "2026-11-19")).toEqual({ mine: true });
    expect(quickPatch("overdue", true, "2026-11-19")).toEqual({ overdue: false });
    expect(quickPatch("today", false, "2026-11-19")).toEqual({ orderFrom: "2026-11-19", orderTo: "2026-11-19" });
    expect(quickPatch("today", true, "2026-11-19")).toEqual({ orderFrom: null, orderTo: null });
  });
  it("faolligi filtrlardan", () => {
    expect(quickOn("today", { ...base, orderFrom: "2026-11-19", orderTo: "2026-11-19" }, "2026-11-19")).toBe(true);
    expect(quickOn("today", { ...base, orderFrom: "2026-11-18", orderTo: "2026-11-19" }, "2026-11-19")).toBe(false);
    expect(quickOn("overdue", { ...base, overdue: true }, "2026-11-19")).toBe(true);
    expect(quickOn("mine", base, "2026-11-19")).toBe(false);
  });
});
