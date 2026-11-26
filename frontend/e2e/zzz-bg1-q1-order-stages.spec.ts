import { expect, test, type Locator, type Page } from "@playwright/test";

/** BG1 Q1 (egasi 26.11.2026): buyurtma bosqichlari bir qatorda yonma-yon, «Yana» menyusisiz; har birida soni va summasi. */
const CEO_LOGIN = process.env.E2E_CEO_LOGIN ?? "ceo";
const CEO_PASSWORD = "Yangi-CEO-parol-2026";

function field(page: Page | Locator, label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return page.getByLabel(new RegExp(`^${escaped}\\s*\\*?$`));
}

test("BG1 Q1: barcha bosqichlar bir qatorda", async ({ page }) => {
  await page.goto("/login");
  await field(page, "Login").fill(CEO_LOGIN);
  await field(page, "Parol").fill(CEO_PASSWORD);
  await page.getByRole("button", { name: "Kirish", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.goto("/orders");
  const strip = page.getByTestId("status-strip");
  for (const name of ["Hammasi", "Qoralama", "Tasdiqlashda", "Navbatda", "Yigʻilmoqda", "Yuklanmoqda", "Yoʻlda", "Yetkazildi"]) {
    await expect(strip.getByRole("tab", { name: new RegExp(`^${name}`) })).toBeAttached();
  }
  await expect(strip.getByRole("button", { name: /^Yana/ })).toHaveCount(0);
  // bir qator: hamma tablar bir xil balandlikda (oʻrab ketmaydi)
  const tops = await strip.getByRole("tab").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
  expect(new Set(tops).size).toBe(1);
  await strip.getByRole("tab", { name: /^Yetkazildi/ }).click();
  await expect(strip.getByRole("tab", { name: /^Yetkazildi/ })).toHaveAttribute("aria-selected", "true");
  await expect(strip.getByRole("tab", { name: /^Yetkazildi/ })).toBeInViewport();
});
