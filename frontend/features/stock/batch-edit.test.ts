import { describe, expect, it } from "vitest";
import { parseUzDate } from "@/features/counterparties/api";
import { validateBatchEdit } from "./batch-edit";

const cur = { number: "A1", producedOn: "2026-01-01", expiryDate: "2028-06-01" };
const ok = { number: "A2", produced: "01.01.2026", expiry: "01.06.2028", reason: "Qadoqdagi raqam" };

describe("partiya tahrirlash tekshiruvi (BG1 B1)", () => {
  it("toʻgʻri forma — xatosiz", () => {
    expect(validateBatchEdit(ok, cur, parseUzDate)).toEqual({});
  });
  it("sabab va muddat majburiy", () => {
    expect(validateBatchEdit({ ...ok, reason: " ", expiry: "" }, cur, parseUzDate)).toEqual({ reason: "required", expiry: "required" });
  });
  it("notoʻgʻri sana va ishlab chiqarilgan sana muddatdan keyin", () => {
    expect(validateBatchEdit({ ...ok, expiry: "32.13.2028" }, cur, parseUzDate).expiry).toBe("date");
    expect(validateBatchEdit({ ...ok, produced: "01.01.2030" }, cur, parseUzDate).produced).toBe("producedAfter");
  });
  it("hech narsa oʻzgarmasa — rad", () => {
    expect(validateBatchEdit({ ...ok, number: "A1" }, cur, parseUzDate).number).toBe("nothing");
  });
  it("ishlab chiqarilgan sanani olib tashlash — oʻzgarish", () => {
    expect(validateBatchEdit({ ...ok, number: "A1", produced: "" }, cur, parseUzDate)).toEqual({});
  });
});
