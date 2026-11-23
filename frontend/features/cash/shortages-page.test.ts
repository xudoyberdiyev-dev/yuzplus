import { describe, expect, it } from "vitest";
import { shortageAmountOk } from "./shortages-page";

describe("KT1: kamomadni yopish summasi", () => {
  it("0 < summa ≤ qoldiq", () => {
    expect(shortageAmountOk("500.00", "500.00")).toBe(true);
    expect(shortageAmountOk("200", "500.00")).toBe(true);
    expect(shortageAmountOk("500.01", "500.00")).toBe(false);
    expect(shortageAmountOk("0", "500.00")).toBe(false);
    expect(shortageAmountOk("", "500.00")).toBe(false);
    expect(shortageAmountOk("abc", "500.00")).toBe(false);
  });
});
