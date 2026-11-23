import { describe, expect, it } from "vitest";
import { formatLeft, sleepLeftMs } from "./sleep-gate";

describe("sleep gate", () => {
  const until = "2026-11-24T12:00:00+05:00";
  it("12:00 gacha — yopiq", () => {
    expect(sleepLeftMs(Date.parse("2026-11-24T11:59:59+05:00"), until)).toBe(1000);
  });
  it("12:00 dan keyin — ochiq", () => {
    expect(sleepLeftMs(Date.parse("2026-11-24T12:00:00+05:00"), until)).toBe(0);
  });
  it("null — hech qachon", () => {
    expect(sleepLeftMs(0, null)).toBe(0);
  });
  it("qolgan vaqt formati", () => {
    expect(formatLeft((10 * 3600 + 58 * 60 + 5) * 1000)).toBe("10:58:05");
  });
});
