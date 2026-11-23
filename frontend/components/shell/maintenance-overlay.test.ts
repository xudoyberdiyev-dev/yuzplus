import { describe, expect, it } from "vitest";
import { isUnderMaintenance } from "./maintenance-overlay";

describe("isUnderMaintenance", () => {
  const until = "2026-11-23T17:00:00+05:00";
  it("vaqtdan oldin — yopiq", () => {
    expect(isUnderMaintenance(Date.parse("2026-11-23T16:59:00+05:00"), until)).toBe(true);
  });
  it("vaqt oʻtgach — ochiq", () => {
    expect(isUnderMaintenance(Date.parse("2026-11-23T17:00:00+05:00"), until)).toBe(false);
  });
  it("null — hech qachon", () => {
    expect(isUnderMaintenance(0, null)).toBe(false);
  });
});
