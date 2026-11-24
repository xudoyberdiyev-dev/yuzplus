import { expect, test, type Page } from "@playwright/test";

/**
 * FT (egasi 24.11.2026): faktura tahriri — ustunni yashirish, qatorni olib tashlash/qaytarish, boʻlim va ustun qoʻshish, shablon.
 * Hammasi faqat faylga: buyurtma oʻzgarmaydi. Maʼlumot oldingi spec'lardan (yigʻilgan buyurtma bor).
 */
test.describe.configure({ mode: "serial" });

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

test("Operator: FT — ustun yashirish, qator olib tashlash, boʻlim, ustun, shablon", async ({ page }) => {
  await login(page, "operator.1", OPERATOR_PASSWORD);
  const res = await page.request.get("/api/orders?statuses=CHECKING,DOCUMENTING,LOADING,IN_TRANSIT,DELIVERED&size=50");
  expect(res.ok()).toBeTruthy();
  const items = ((await res.json()) as { items: { id: number }[] }).items;
  test.skip(items.length === 0, "yigʻilgan buyurtma yoʻq");
  const id = items[0].id;
  const before = await (await page.request.get(`/api/orders/${id}`)).text();

  await page.goto(`/orders/${id}`);
  await page.getByRole("button", { name: "Chop etish" }).click();
  await page.getByRole("menuitem", { name: "Faktura: Фактура Для клиента №1" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Tuzatishlar faqat faylga yoziladi")).toBeVisible();

  // FT1: «Серия» ni yashirish
  await dialog.getByRole("button", { name: "Ustunlar" }).click();
  await dialog.getByRole("group", { name: "Fakturada koʻrinadigan ustunlar" }).getByText("Серия", { exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Ustunlar · 1 yashirin" })).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(dialog.getByText(/Kulrang ustunlar faylga chiqmaydi \(Серия\)/)).toBeVisible();

  // FT4: ustun qoʻshish
  await dialog.getByRole("button", { name: "Ustun qoʻshish" }).first().click();
  await expect(dialog.getByRole("textbox", { name: "Ustun nomi" })).toHaveValue("Изоҳ");

  // FT2: 1-qatorni olib tashlash va qaytarish
  await dialog.getByRole("checkbox", { name: "1-qatorni tanlash" }).check({ force: true });
  await expect(dialog.getByText("1 ta qator tanlandi")).toBeVisible();
  await dialog.getByRole("button", { name: "Fakturadan olib tashlash" }).click();
  await expect(dialog.getByText("Olib tashlangan qatorlar: 1")).toBeVisible();
  await dialog.getByRole("button", { name: "Qaytarish", exact: true }).click();
  await expect(dialog.getByText("Olib tashlangan qatorlar: 0")).toBeVisible();

  // FT3: boʻlim qoʻshish
  await dialog.getByRole("button", { name: "Boʻlim qoʻshish" }).click();
  await expect(dialog.getByRole("textbox", { name: "Boʻlim nomi" })).toHaveValue("Янги бўлим");
  await expect(dialog.getByText(/saqlandi:/)).toBeVisible({ timeout: 10_000 });

  const saved = (await (await page.request.get(`/api/orders/${id}/invoice-forms?type=CLIENT1`)).json()) as {
    hidden: Record<string, string[]>;
    extraColumns: { title: string }[];
    rows: { kind?: string }[];
  };
  expect(saved.hidden.CLIENT1).toContain("series");
  expect(saved.extraColumns.map((c) => c.title)).toContain("Изоҳ");
  expect(saved.rows.some((r) => r.kind === "SECTION")).toBeTruthy();

  // FT5: shablon saqlash va oʻchirish
  await dialog.getByRole("button", { name: "Shablon sifatida saqlash" }).click();
  await expect(page.getByText(/Shablon saqlandi/)).toBeVisible();
  await dialog.getByRole("button", { name: "Shablon", exact: true }).click();
  await page.getByRole("menuitem", { name: "Shablonni oʻchirish" }).click();
  await expect(page.getByText("Shablon oʻchirildi")).toBeVisible();

  // Buyurtma oʻzgarmagan; asl holatiga
  expect(await (await page.request.get(`/api/orders/${id}`)).text()).toBe(before);
  await dialog.getByRole("button", { name: "Asl holatiga" }).click();
  await expect(dialog.getByRole("textbox", { name: "Boʻlim nomi" })).toHaveCount(0);
});
