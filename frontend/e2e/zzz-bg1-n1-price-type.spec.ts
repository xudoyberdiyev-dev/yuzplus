import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * BG1 N1 (egasi 26.11.2026): yangi narx turi yaratiladi → «Narx oʻrnatish»da darhol koʻrinadi; partiya boʻyicha tur
 * «Mahsulot boʻyicha»da yoʻl-yoʻriq bilan, «Kirim boʻyicha»da birinchi qatorda.
 */
const CEO_LOGIN = process.env.E2E_CEO_LOGIN ?? "ceo";
const CEO_PASSWORD = "Yangi-CEO-parol-2026";

function field(page: Page | Locator, label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return page.getByLabel(new RegExp(`^${escaped}\\s*\\*?$`));
}

async function createType(page: Page, name: string, batch: boolean) {
  await page.goto("/prices");
  await page.getByRole("button", { name: "Narx turi yaratish", exact: true }).click();
  const dlg = page.getByRole("dialog");
  await field(dlg, "Nomi").fill(name);
  if (batch) await dlg.getByRole("switch", { name: "Partiya boʻyicha" }).click();
  await dlg.getByRole("button", { name: "Saqlash", exact: true }).click();
  await expect(page.getByText(`«${name}» yaratildi`)).toBeVisible();
}

test("BG1 N1: yangi narx turi Narx oʻrnatishda koʻrinadi", async ({ page }) => {
  await page.goto("/login");
  await field(page, "Login").fill(CEO_LOGIN);
  await field(page, "Parol").fill(CEO_PASSWORD);
  await page.getByRole("button", { name: "Kirish", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);

  const stamp = Date.now().toString().slice(-6);
  const plain = `E2E oddiy ${stamp}`;
  const batch = `E2E partiya ${stamp}`;
  await createType(page, plain, false);
  await createType(page, batch, true);

  await page.getByRole("button", { name: "Narx oʻrnatish", exact: true }).click();
  await expect(page).toHaveURL(/\/prices\/set/);
  const typeSelect = page.getByRole("combobox", { name: "Narx turi" });
  await typeSelect.click();
  await expect(page.getByRole("option", { name: new RegExp(plain) })).toBeVisible();
  await page.getByRole("option", { name: new RegExp(batch) }).click();
  await expect(page.getByText(`«${batch}» — partiya boʻyicha narx turi`)).toBeVisible();
  await page.getByRole("button", { name: "Kirim boʻyicha ochish" }).click();
  await expect(page.getByRole("tab", { name: "Kirim boʻyicha" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("combobox", { name: "Narx turi" })).toContainText(batch);
});
