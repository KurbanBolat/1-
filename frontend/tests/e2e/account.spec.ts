import { expect, test } from "@playwright/test";

test("account page shows clean RU localization without mojibake", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto("/account?lang=ru&currency=KZT");

  await expect(page.getByRole("heading", { level: 1 })).toContainText("Личный кабинет гостя");
  await expect(page.getByText("Профиль гостя")).toBeVisible();
  await expect(page.getByRole("link", { name: /Назад к поиску/i })).toBeVisible();

  const body = page.locator("body");
  await expect(body).not.toContainText("Р вЂєР ");
  await expect(body).not.toContainText("РІР‚Сћ");
  await expect(body).not.toContainText("РІвЂ С’");
  await expect(body).not.toContainText("Рќ");
  await expect(body).not.toContainText("Рџ");
});

test("account page explains secure access when email has no token", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto("/account?lang=ru&currency=KZT");

  await page.locator('input[type="email"]').fill(`guest_${Date.now()}@example.com`);
  await page.getByRole("button", { name: /Показать брони/i }).click();

  await expect(page.locator(".field-error")).toContainText("по ссылке с токеном доступа");
  await expect(page.locator("body")).not.toContainText("Reservation access token is required");
});
