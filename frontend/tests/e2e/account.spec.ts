import { expect, test } from "@playwright/test";

const MOJIBAKE_MARKERS = [
  "\u0420\u203A",
  "\u0420\u045C",
  "\u0420\u045F",
  "\u0420\u0402",
  "\u0420\u2018",
  "\u0420\u040B",
  "\u0420\u040E",
  "\u0420\u0403",
  "\u0421\u040A",
  "\u0421\u2039",
  "\u0421\u040F",
  "\u0421\u2021",
  "\u0421\u201A",
  "\u0421\u0402",
  "\u0421\u0453",
  "\u0421\u2020",
];

test("account page shows clean RU localization without mojibake", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto("/account?lang=ru&currency=KZT");

  await expect(page.getByRole("heading", { level: 1 })).toContainText("Личный кабинет гостя");
  await expect(page.getByText("Введите email, чтобы открыть брони")).toBeVisible();
  await expect(page.getByText("По этому email брони не найдены.")).toHaveCount(0);
  await expect(page.getByText("Профиль гостя")).toBeVisible();
  await expect(page.getByRole("link", { name: /Назад к поиску/i })).toBeVisible();

  const body = page.locator("body");
  for (const marker of MOJIBAKE_MARKERS) {
    await expect(body).not.toContainText(marker);
  }
  await expect(body).not.toContainText(/Room service|in-stay/i);
});

test("account page explains secure access when email has no token", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto("/account?lang=ru&currency=KZT");

  await page.locator('input[type="email"]').fill(`guest_${Date.now()}@example.com`);
  await page.getByRole("button", { name: /Показать брони/i }).click();

  await expect(page.locator(".field-error")).toContainText("по ссылке с токеном доступа");
  await expect(page.getByText("По этому email брони не найдены.")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("Reservation access token is required");
});
