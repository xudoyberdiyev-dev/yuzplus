import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * BG1 B2/B3 (egasi 26.11.2026): kirimdagi «Mahsulot qoʻshish» katalogi — toʻliq sahifa (modal emas); bir mahsulotga ikkinchi
 * partiya «+ partiya» bilan; «Qoʻshish va qaytish» kirimga qaytaradi, kiritilgan sarlavha maydonlari yoʻqolmaydi.
 */
const CEO_LOGIN = process.env.E2E_CEO_LOGIN ?? "ceo";
const CEO_PASSWORD = "Yangi-CEO-parol-2026";

function field(page: Page | Locator, label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return page.getByLabel(new RegExp(`^${escaped}\\s*\\*?$`));
}

test("BG1 B2/B3: kirim katalogi sahifa, ikki partiya", async ({ page }) => {
  await page.goto("/login");
  await field(page, "Login").fill(CEO_LOGIN);
  await field(page, "Parol").fill(CEO_PASSWORD);
  await page.getByRole("button", { name: "Kirish", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.goto("/receipts");
  await page.getByRole("button", { name: "Yangi kirim" }).first().click();
  await page.getByRole("combobox", { name: "Ombor", exact: true }).click();
  await page.getByRole("option", { name: /Markaziy ombor/ }).click();
  await field(page, "Yetkazib beruvchi nakladnoyi raqami").fill("YX-B2");

  await page.getByRole("button", { name: "Mahsulot qoʻshish" }).first().click();
  await expect(page.getByRole("heading", { name: "Mahsulot qoʻshish" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("searchbox", { name: "Qidirish" }).fill("Paracetamol E2E");
  const batch = page.getByLabel(/Paracetamol E2E 500 mg: partiya/);
  await expect(batch).toHaveCount(1);
  await page.getByRole("button", { name: /Paracetamol E2E 500 mg: yana bir partiya/ }).click();
  await expect(batch).toHaveCount(2);
  const fill = async (i: number, b: string, exp: string, qty: string) => {
    await batch.nth(i).fill(b);
    await page
      .getByLabel(/Paracetamol E2E 500 mg: yaroqlilik/)
      .nth(i)
      .fill(exp);
    await page
      .getByLabel(/Paracetamol E2E 500 mg: soni/)
      .nth(i)
      .fill(qty);
  };
  await fill(0, "B2-A", "30.06.2029", "3");
  await fill(1, "B2-B", "31.12.2029", "4");
  await page.getByRole("button", { name: /Qoʻshish va qaytish · 2/ }).click();

  await expect(page.getByText("2 qator qoʻshildi")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Mahsulot qoʻshish" })).toHaveCount(0);
  await expect(field(page, "Yetkazib beruvchi nakladnoyi raqami").first()).toHaveValue("YX-B2");
  await expect(page.getByText("Qatorlar · 2", { exact: true })).toBeVisible();
});
