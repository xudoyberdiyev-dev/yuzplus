import { describe, expect, it } from "vitest";
import { nextStopId, roadUrl, tripHandover } from "./driver-model";

const stop = (id: number, seq: number, extra: Record<string, unknown> = {}) => ({
  id,
  seq,
  customer: `Mijoz ${id}`,
  paymentType: "CASH",
  total: "100000.00",
  ...extra,
});

describe("HD3: veb haydovchi paneli", () => {
  it("keyingi manzil — tartib boʻyicha birinchi natijasiz", () => {
    expect(nextStopId([stop(5, 2), stop(4, 1, { outcome: "DELIVERED" }), stop(6, 3)])).toBe(5);
    expect(nextStopId([stop(1, 1, { outcome: "UNDELIVERED" })])).toBeNull();
  });

  it("navigator havolasi manzil boʻyicha", () => {
    expect(roadUrl(" Chilonzor 5 ")).toBe("https://yandex.uz/maps/?text=Chilonzor%205");
    expect(roadUrl(null)).toBeNull();
  });

  it("topshirish: olinishi kerak (qisman — qaytgan qism ayirilgan), olingan, qaytadigan tovar", () => {
    const h = tripHandover(
      [
        stop(1, 1, { outcome: "DELIVERED", cashCollected: "100000.00" }),
        stop(2, 2, { outcome: "PARTIAL", returnTotal: "30000.00", returnNumber: "QM-TSH-000001", cashCollected: "60000.00" }),
        stop(3, 3, { outcome: "UNDELIVERED" }),
        stop(4, 4, { outcome: "DELIVERED", paymentType: "TRANSFER" }),
      ],
      "RETURN_WAIT",
    );
    expect(h.due).toBe("170000.00");
    expect(h.got).toBe("160000.00");
    expect(h.cashDone).toBe(false);
    expect(h.returns).toEqual(["Mijoz 2 · QM-TSH-000001", "Mijoz 3"]);
    expect(tripHandover([], "DONE").goodsDone).toBe(true);
  });
});
