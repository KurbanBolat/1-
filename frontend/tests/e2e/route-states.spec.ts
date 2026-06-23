import { expect, test } from "@playwright/test";

test("not found page renders the StayPilot route state", async ({ page }) => {
  await page.goto("/definitely-missing?lang=ru&currency=KZT");

  await expect(page.locator(".route-state")).toBeVisible();
  await expect(page.locator(".route-state h1")).toContainText("Страница не найдена");
  await expect(page.locator(".route-state-action")).toHaveCount(2);
  await expect(page.locator("main main")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(/Unhandled Runtime Error|Application error|Failed to compile/i);
});
