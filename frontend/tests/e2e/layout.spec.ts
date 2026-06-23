import { expect, test } from "@playwright/test";

const routes = [
  "/?lang=ru&currency=KZT&city=Dubai&guests=2",
  "/for-hotels?lang=ru&currency=KZT",
  "/demo?lang=ru&currency=KZT",
  "/account?lang=ru&currency=KZT",
];

const viewports = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 900 },
  { name: "desktop", width: 1365, height: 768 },
];

test("public pages do not create page-level horizontal overflow", async ({ page }) => {
  for (const viewport of viewports) {
    await test.step(viewport.name, async () => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });

      for (const route of routes) {
        await test.step(route, async () => {
          await page.goto(route, { waitUntil: "load" });
          await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
          await expect(page.locator("body")).not.toContainText(
            /Unhandled Runtime Error|Application error|Failed to compile/i,
          );

          const overflowX = await page.evaluate(() =>
            Math.ceil(document.documentElement.scrollWidth - document.documentElement.clientWidth),
          );
          expect(overflowX, `${viewport.name} ${route}`).toBeLessThanOrEqual(2);
        });
      }
    });
  }
});
