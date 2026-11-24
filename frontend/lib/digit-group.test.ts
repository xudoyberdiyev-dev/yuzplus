import { describe, expect, it } from "vitest";
import { caretAfter, groupDigits, ungroupDigits } from "./digit-group";

const S = " ";

describe("groupDigits", () => {
  it("minglarni boʻsh joy bilan ajratadi", () => {
    expect(groupDigits("1000000")).toBe(`1${S}000${S}000`);
    expect(groupDigits("10000")).toBe(`10${S}000`);
    expect(groupDigits("999")).toBe("999");
  });
  it("kasr qismini va belgini saqlaydi", () => {
    expect(groupDigits("1250000,50")).toBe(`1${S}250${S}000,50`);
    expect(groupDigits("1250000.5")).toBe(`1${S}250${S}000.5`);
    expect(groupDigits("-12000")).toBe(`-12${S}000`);
    expect(groupDigits("1000,")).toBe(`1${S}000,`);
  });
  it("boʻsh va raqam boʻlmagan qiymat oʻzgarmaydi", () => {
    expect(groupDigits("")).toBe("");
    expect(groupDigits("12a")).toBe("12a");
  });
  it("qayta guruhlash barqaror", () => {
    expect(groupDigits(groupDigits("1234567"))).toBe(`1${S}234${S}567`);
  });
});

describe("ungroupDigits", () => {
  it("har xil boʻsh joylarni olib tashlaydi", () => {
    expect(ungroupDigits(`1${S}000 000 000`)).toBe("1000000000");
  });
});

describe("caretAfter", () => {
  it("boʻsh joylarni hisobga olmay kursor oʻrnini topadi", () => {
    const d = `1${S}000${S}000`;
    expect(caretAfter(d, 1)).toBe(1);
    expect(caretAfter(d, 2)).toBe(3);
    expect(caretAfter(d, 7)).toBe(d.length);
    expect(caretAfter(d, 0)).toBe(0);
  });
});
