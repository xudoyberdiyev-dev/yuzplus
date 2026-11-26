import { expect, test, type Page } from "@playwright/test";

/**
 * FT6 (egasi 26.11.2026): buyurtma → «Chop etish» → «Mijoz hujjatlari (3 ta)» — hisob varaq-faktura, tijorat taklifi, spetsifikatsiya.
 * Filial rahbarida `invoices.costPrint` bor, operatorda yoʻq. Raqamlar namunaga mosligi — backend IT (OrderIT.clientDocsMatchOwnerSample).
 */
test.describe.configure({ mode: "serial" });

const PASSWORD = "Rol-parol-2026";
const OPERATOR_PASSWORD = "Operator-parol-2026";

function field(page: Page, label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return page.getByLabel(new RegExp(`^${escaped}\\s*\\*?$`));
}

async function login(page: Page, login: string, password: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await field(page, "Login").fill(login);
  await field(page, "Parol").fill(password);
  await page.getByRole("button", { name: "Kirish", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
}

test("Filial rahbari: mijoz hujjatlari oynasi; operatorga yopiq", async ({ page }) => {
  await login(page, "manager.1", PASSWORD);
  const res = await page.request.get("/api/orders?statuses=CHECKING,DOCUMENTING,LOADING,IN_TRANSIT,DELIVERED&size=50");
  expect(res.ok()).toBeTruthy();
  const items = ((await res.json()) as { items: { id: number }[] }).items;
  test.skip(items.length === 0, "yigʻilgan buyurtma yoʻq");
  const id = items[0].id;
  const info = await page.request.get(`/api/orders/${id}/client-docs`);
  expect(info.ok()).toBeTruthy();

  await page.goto(`/orders/${id}`);
  await page.getByRole("button", { name: "Chop etish" }).click();
  await page.getByRole("menuitem", { name: "Mijoz hujjatlari (3 ta)" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Hisob varaq-faktura, tijorat taklifi va spetsifikatsiya")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Tijorat taklifi" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Spetsifikatsiya" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Hammasini yuklab olish" })).toBeVisible();
  await dialog.getByRole("button", { name: "Yopish" }).last().click();

  await login(page, "operator.1", OPERATOR_PASSWORD);
  expect((await page.request.get(`/api/orders/${id}/client-docs`)).status()).toBe(403);
  await page.goto(`/orders/${id}`);
  await page.getByRole("button", { name: "Chop etish" }).click();
  await expect(page.getByRole("menuitem", { name: "Mijoz hujjatlari (3 ta)" })).toHaveCount(0);
});
