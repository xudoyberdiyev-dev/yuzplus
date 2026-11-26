import { describe, expect, it } from "vitest";
import { clientDocUrl, CLIENT_DOC_KINDS, contractLabel, initialContract } from "./client-docs";

describe("FT6 mijoz hujjatlari", () => {
  it("shartnoma koʻrinishi va boshlangʻich tanlov", () => {
    expect(contractLabel({ number: "1478", signedOn: "2026-01-05" })).toBe("№ 1478 · 05.01.2026");
    expect(contractLabel({ number: "12", signedOn: undefined })).toBe("№ 12");
    expect(
      initialContract({ contract: { id: 7, number: "1478", signedOn: undefined, validUntil: undefined }, suggestedContractId: 9 }),
    ).toBe("7");
    expect(initialContract({ contract: undefined, suggestedContractId: 9 })).toBe("9");
    expect(initialContract({ contract: undefined, suggestedContractId: undefined })).toBeNull();
  });

  it("fayl manzillari: uchta hujjat va arxiv", () => {
    expect(CLIENT_DOC_KINDS).toEqual(["INVOICE", "OFFER", "SPECIFICATION"]);
    expect(clientDocUrl(5, "OFFER")).toBe("/api/orders/5/client-docs/OFFER/xlsx");
    expect(clientDocUrl(5, "zip")).toBe("/api/orders/5/client-docs/zip");
  });
});
