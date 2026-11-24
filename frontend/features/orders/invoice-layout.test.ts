import { describe, expect, it } from "vitest";
import { changedCells } from "./invoice-forms";
import {
  addSection,
  duplicate,
  grandTotal,
  moveToSection,
  nextExtraKey,
  removeExtraColumn,
  removeSection,
  sectionRow,
  setRemoved,
  toggleHidden,
  viewLines,
  type FormRow,
} from "./invoice-layout";

const r = (name: string, qty = 1, price = "10.00"): FormRow => ({ name, qty, price });
const total = (x: FormRow) => (BigInt(Math.round(Number(x.price ?? 0) * 100)) * BigInt(x.qty)).toString().replace(/(\d{2})$/, ".$1");

describe("FT faktura tahriri", () => {
  it("boʻlimlar: sarlavha, qatorlar soni, «Boʻlim jami»; olib tashlangan qator koʻrinmaydi va jamiga kirmaydi", () => {
    const rows = [r("A", 2), sectionRow("ДОРИ"), r("B", 3), { ...r("C", 5), removed: true }, sectionRow("БОШҚА")];
    const lines = viewLines(rows, total);
    expect(lines).toEqual([
      { kind: "row", index: 0, no: 1, item: 0 },
      { kind: "section", index: 1, title: "ДОРИ", count: 1 },
      { kind: "row", index: 2, no: 2, item: 1 },
      { kind: "subtotal", section: 1, qty: 3, sum: "30.00" },
      { kind: "section", index: 4, title: "БОШҚА", count: 0 },
    ]);
    expect(grandTotal(rows, total)).toEqual({ qty: 5, sum: "50.00" });
  });

  it("olib tashlash va qaytarish; boʻlim sarlavhasi olib tashlanmaydi", () => {
    const rows = [sectionRow("S"), r("A")];
    const off = setRemoved(rows, [0, 1], true);
    expect(off[0].removed).toBeUndefined();
    expect(off[1].removed).toBe(true);
    expect(setRemoved(off, [1], false)[1].removed).toBeUndefined();
  });

  it("nusxa — qatordan keyin", () => {
    expect(duplicate([r("A"), r("B")], [0]).map((x) => x.name)).toEqual(["A", "A", "B"]);
  });

  it("boʻlimga koʻchirish — boʻlim oxiriga, keyingi boʻlimdan oldin", () => {
    const rows = [r("A"), r("B"), sectionRow("S1"), r("C"), sectionRow("S2"), r("D")];
    expect(moveToSection(rows, [0, 5], 2).map((x) => x.name)).toEqual(["B", "S1", "C", "A", "D", "S2"]);
    expect(moveToSection(rows, [], 2)).toBe(rows);
    expect(moveToSection(rows, [0], 1)).toBe(rows);
  });

  it("boʻlim qoʻshish (tanlanganlar bilan) va oʻchirish", () => {
    const next = addSection([r("A"), r("B")], "YANGI", [0]);
    expect(next.map((x) => x.name)).toEqual(["B", "YANGI", "A"]);
    expect(next[1].kind).toBe("SECTION");
    expect(removeSection(next, 1).map((x) => x.name)).toEqual(["B", "A"]);
    expect(removeSection(next, 0)).toBe(next);
  });

  it("ustunlarni yashirish — tur boʻyicha, nom yashirilmaydi", () => {
    let h = toggleHidden({}, "CLIENT1", "series");
    h = toggleHidden(h, "CLIENT1", "price");
    expect(h).toEqual({ CLIENT1: ["series", "price"] });
    expect(toggleHidden(h, "CLIENT1", "name")).toBe(h);
    expect(toggleHidden({ CLIENT1: ["series"] }, "CLIENT1", "series")).toEqual({});
  });

  it("qoʻshilgan ustun: kalit va olib tashlash (kataklari va yashirish bilan)", () => {
    expect(nextExtraKey([])).toBe("x1");
    expect(
      nextExtraKey([
        { key: "x1", title: "A" },
        { key: "x4", title: "B" },
      ]),
    ).toBe("x5");
    const doc = removeExtraColumn(
      {
        rows: [
          { ...r("A"), extra: { x1: "Aksiya", x2: "z" } },
          { ...r("B"), extra: { x1: "1" } },
        ],
        extraColumns: [
          { key: "x1", title: "Изоҳ" },
          { key: "x2", title: "Z" },
        ],
        hidden: { CLIENT1: ["x1"], CLIENT2: ["x1", "series"] },
      },
      "x1",
    );
    expect(doc.extraColumns.map((c) => c.key)).toEqual(["x2"]);
    expect(doc.rows[0].extra).toEqual({ x2: "z" });
    expect(doc.rows[1].extra).toBeUndefined();
    expect(doc.hidden).toEqual({ CLIENT2: ["series"] });
  });

  it("tuzatilgan kataklar: boʻlim, olib tashlangan qator va qoʻshilgan ustun katagi hisoblanadi", () => {
    const orig = [r("A"), r("B")];
    expect(changedCells([sectionRow("S"), r("A"), r("B")], orig)).toBe(1);
    expect(changedCells([r("A"), { ...r("B"), removed: true, extra: { x1: "Aksiya", x2: " " } }], orig)).toBe(2);
  });
});
