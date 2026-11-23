import { test } from "node:test";
import assert from "node:assert/strict";
import { advanceLeft, checkDraft, defaultSource, type ExpenseDraft } from "./expense-core.ts";

const base: ExpenseDraft = { kind: "MEAL", amount: 3000000n, source: "OWN", note: "", photo: null, liters: "", price: 0n, odometer: "" };

test("HD2: yoqilgʻida chek rasmi, «Boshqa» da izoh majburiy", () => {
  assert.equal(checkDraft(base), null);
  assert.equal(checkDraft({ ...base, amount: 0n }), "amount");
  assert.equal(checkDraft({ ...base, kind: "FUEL" }), "photo");
  assert.equal(checkDraft({ ...base, kind: "FUEL", photo: "file:///chek.jpg", liters: "12,5" }), null);
  assert.equal(checkDraft({ ...base, kind: "OTHER" }), "note");
  assert.equal(checkDraft({ ...base, liters: "abc" }), "liters");
  assert.equal(checkDraft({ ...base, odometer: "12.5" }), "odometer");
});

test("HD2: avans qoldigʻi va boshlangʻich manba", () => {
  const left = advanceLeft(30000000n, [
    { amount: 12000000n, source: "ADVANCE", rejected: false },
    { amount: 5000000n, source: "OWN", rejected: false },
    { amount: 4000000n, source: "ADVANCE", rejected: true },
  ]);
  assert.equal(left, 18000000n);
  assert.equal(defaultSource(left, 10000000n), "ADVANCE");
  assert.equal(defaultSource(left, 20000000n), "COLLECTED");
  assert.equal(defaultSource(0n, 1n), "COLLECTED");
});
