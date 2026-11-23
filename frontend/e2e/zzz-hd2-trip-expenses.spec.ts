import { expect, test, type Page } from "@playwright/test";

/**
 * HD2 (egasi 23.11.2026): kassir naqd qabulida yoʻl xarajatlarini tasdiqlaydi / rad etadi, avans hisobga olinadi.
 * Reys maʼlumotlari brauzerda soxtalashtiriladi (page.route) — tekshiriladi: hisob-kitob (naqd + avans − tasdiqlangan),
 * rad etish sababi majburiy va serverga yuboriladigan qarorlar; «Yoʻl xarajatlari» sahifasi hisoboti. Backend mantigʻi — OrderIT.
 */
test.describe.configure({ mode: "serial" });

const PASSWORD = "Rol-parol-2026";

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

const expense = (id: number, kind: string, amount: string, source: string, photos: number, note: string | null) => ({
  id,
  tripId: 990001,
  tripNumber: "RS-TSH-990001",
  kind,
  amount,
  source,
  note,
  liters: kind === "FUEL" ? "12.50" : null,
  price: kind === "FUEL" ? "9600.00" : null,
  odometer: null,
  lat: null,
  lng: null,
  spentAt: "2026-11-23T08:00:00Z",
  status: "PENDING",
  rejectReason: null,
  decidedBy: null,
  settled: false,
  cashOp: null,
  photos,
  driver: "Hasan Haydovchiyev",
  vehicle: "01 E 777 EE",
});

const MONEY = {
  tripId: 990001,
  tripNumber: "RS-TSH-990001",
  tripStatus: "RETURN_WAIT",
  driver: "Hasan Haydovchiyev",
  branchId: 1,
  advances: [
    {
      id: 1,
      amount: "300000.00",
      cashOp: "KO-TSH-000901",
      note: null,
      createdBy: "Kassir",
      createdAt: "2026-11-23T03:00:00Z",
      settled: false,
    },
  ],
  expenses: [expense(11, "FUEL", "120000.00", "ADVANCE", 1, null), expense(12, "OTHER", "50000.00", "COLLECTED", 0, "Moyka")],
  advanceOpen: "300000.00",
  expensesOpen: "170000.00",
  pending: 2,
};

test("Kassir: yoʻl xarajatlarini tasdiqlaydi / rad etadi — topshiriladigan summa va qarorlar", async ({ page }) => {
  let sent: Record<string, unknown> | null = null;
  await page.route(/\/api\/trips\/cash(\?|$)/, (r) => r.fulfill({ json: [] }));
  await page.route(/\/api\/trips\/cash\/extras/, (r) => r.fulfill({ json: sent ? [] : [MONEY] }));
  await page.route(/\/api\/trips\/990001\/cash\/accept/, async (r) => {
    sent = r.request().postDataJSON() as Record<string, unknown>;
    await r.fulfill({
      json: {
        expected: "180000.00",
        received: "180000.00",
        diff: "0.00",
        payments: [],
        unpaid: "0.00",
        shortage: "0.00",
        advance: "300000.00",
        expenses: "120000.00",
        cashOps: ["KO-TSH-000902", "KO-TSH-000903"],
      },
    });
  });
  await login(page, "cashier.1", PASSWORD);
  await page.goto("/cash");
  const section = page.locator("section").filter({ has: page.getByRole("heading", { name: "Haydovchilardan kutilayotgan pul" }) });
  await expect(section).toContainText("RS-TSH-990001");
  await expect(section).toContainText("Avans");
  await section.getByRole("button", { name: "Qabul qilish", exact: true }).click();
  // Ikkalasi tasdiqlansa: 0 + 300 000 − 170 000 = 130 000
  await expect(section).toContainText("Topshiriladi: 130.000,00 soʻm");
  const moyka = section.locator("div.rounded-control").filter({ hasText: "Moyka" }).first();
  await moyka.getByText("Rad etish", { exact: true }).click();
  await expect(section).toContainText("Topshiriladi: 180.000,00 soʻm");
  await expect(section).toContainText("Rad etilgan 50.000,00 soʻm");
  await section.getByRole("button", { name: "Pulni qabul qilish" }).click();
  await expect(section.getByText("Rad etish sababini yozing")).toBeVisible();
  await field(page, "Rad etish sababi").fill("Chek yoʻq");
  await section.getByRole("button", { name: "Pulni qabul qilish" }).click();
  await expect(page.getByText("Pul qabul qilindi").first()).toBeVisible();
  expect(sent).not.toBeNull();
  expect(sent!.received).toBe("180000.00");
  expect(sent!.expenses).toEqual([
    { expenseId: 11, approve: true },
    { expenseId: 12, approve: false, reason: "Chek yoʻq" },
  ]);
});

test("Kassir: «Yoʻl xarajatlari» sahifasi — roʻyxat va hisobot", async ({ page }) => {
  await page.route(/\/api\/trip-expenses(\?|$)/, (r) =>
    r.fulfill({
      json: {
        rows: MONEY.expenses,
        byDriver: [
          {
            key: "Hasan Haydovchiyev",
            label: "Hasan Haydovchiyev",
            count: 2,
            total: "170000.00",
            approved: "0.00",
            liters: "12.50",
            km: null,
            perKm: null,
          },
        ],
        byVehicle: [
          {
            key: "01 E 777 EE",
            label: "01 E 777 EE",
            count: 2,
            total: "170000.00",
            approved: "120000.00",
            liters: "12.50",
            km: 240,
            perKm: "500.00",
          },
        ],
        byMonth: [],
        byKind: [],
        total: "170000.00",
        approved: "0.00",
        pending: 2,
      },
    }),
  );
  await login(page, "cashier.1", PASSWORD);
  await page.goto("/cash");
  await page.getByRole("button", { name: "Yoʻl xarajatlari" }).click();
  await expect(page).toHaveURL(/\/cash\/trip-expenses/);
  await expect(page.getByRole("heading", { name: "Yoʻl xarajatlari", level: 1 })).toBeVisible();
  await expect(page.getByRole("main")).toContainText("Moyka");
  await expect(page.getByRole("main")).toContainText("170.000,00");
  await page.getByRole("tab", { name: "Mashina" }).click();
  await expect(page.getByRole("main")).toContainText("500,00");
});
