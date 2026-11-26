import { describe, expect, it } from "vitest";
import { collectPicks, EMPTY_INPUT, productSlots, slotKey } from "./receipt-catalog";

const rows = [
  { productId: 1, code: "0001", name: "Ibuprofen", lastPrice: "15000.50" },
  { productId: 2, code: "0002", name: "Sitramon", lastPrice: null },
  { productId: 3, code: "0003", name: "Analgin" },
];

describe("collectPicks", () => {
  it("toʻliq qatorlar qoʻshiladi, boʻsh narx — oxirgi narx, boʻsh qator eʼtiborsiz", () => {
    const { picks, errors } = collectPicks(
      rows,
      {
        1: { ...EMPTY_INPUT, batch: " IB-1 ", expiry: "01.12.2027", qty: "10", bonus: "1" },
        2: { ...EMPTY_INPUT, batch: "S-1", expiry: "01.06.2027", qty: "5", price: "1.200,50" },
        3: { ...EMPTY_INPUT },
      },
      { zoneId: 7, pricesVisible: true, existing: new Set() },
    );
    expect(errors).toEqual({});
    expect(picks).toEqual([
      expect.objectContaining({
        productId: 1,
        batchNumber: "IB-1",
        expiryDate: "01.12.2027",
        zoneId: 7,
        qty: "10",
        bonusQty: "1",
        price: "15000.50",
      }),
      expect.objectContaining({ productId: 2, price: "1200.50" }),
    ]);
  });

  it("chala qator, notoʻgʻri sana va takror partiya — xato; narx koʻrinmasa narx yuborilmaydi", () => {
    const { picks, errors } = collectPicks(
      rows,
      {
        1: { ...EMPTY_INPUT, qty: "3" },
        2: { ...EMPTY_INPUT, batch: "S-1", expiry: "31.02.2027", qty: "1" },
        3: { ...EMPTY_INPUT, batch: "a-1", expiry: "01.01.2028", qty: "2", price: "999" },
      },
      { zoneId: 7, pricesVisible: false, existing: new Set(["3|A-1"]) },
    );
    expect(picks).toEqual([]);
    expect(errors).toEqual({ 1: "batch", 2: "expiry", 3: "duplicate" });

    const ok = collectPicks(
      rows,
      { 3: { ...EMPTY_INPUT, batch: "A-2", expiry: "01.01.2028", qty: "2", price: "999" } },
      {
        zoneId: 7,
        pricesVisible: false,
        existing: new Set(),
      },
    );
    expect(ok.picks[0]?.price).toBe("");
  });
});

describe("bir mahsulotga bir nechta partiya (BG1 B3)", () => {
  it("«+ partiya» qatorlari alohida qoʻshiladi; shu katalogda takror partiya — xato", () => {
    const { picks, errors } = collectPicks(
      rows,
      {
        1: { ...EMPTY_INPUT, batch: "IB-1", expiry: "01.12.2027", qty: "10" },
        [slotKey(1, 1)]: { ...EMPTY_INPUT, batch: "IB-2", expiry: "01.03.2028", qty: "4" },
        [slotKey(1, 2)]: { ...EMPTY_INPUT, batch: "ib-1", expiry: "01.03.2028", qty: "1" },
      },
      { zoneId: 7, pricesVisible: false, existing: new Set() },
    );
    expect(picks.map((p) => `${p.productId}:${p.batchNumber}:${p.qty}`)).toEqual(["1:IB-1:10", "1:IB-2:4"]);
    expect(errors).toEqual({ "1:2": "duplicate" });
  });
  it("partiya tartibi va kalitlar", () => {
    expect(slotKey(5, 0)).toBe("5");
    expect(slotKey(5, 3)).toBe("5:3");
    expect(productSlots(5, { "5:2": EMPTY_INPUT, "5": EMPTY_INPUT, "55": EMPTY_INPUT, "5:10": EMPTY_INPUT })).toEqual(["5", "5:2", "5:10"]);
  });
});
