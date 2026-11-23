import { describe, expect, it } from "vitest";
import { expenseFormError } from "./driver-expenses";

describe("HD2: haydovchi xarajat formasi", () => {
  const chek = new File([new Uint8Array([1])], "chek.jpg", { type: "image/jpeg" });
  it("summa, yoqilgʻida chek rasmi, «Boshqa» da izoh majburiy", () => {
    expect(expenseFormError("MEAL", "30000", null, "")).toBeNull();
    expect(expenseFormError("MEAL", "0", null, "")).toBe("amount");
    expect(expenseFormError("MEAL", "abc", null, "")).toBe("amount");
    expect(expenseFormError("FUEL", "120000", null, "")).toBe("photo");
    expect(expenseFormError("FUEL", "120000,50", chek, "")).toBeNull();
    expect(expenseFormError("OTHER", "5000", null, " ")).toBe("note");
  });
});
