const { test, expect } = require("@playwright/test");

test.beforeEach(async ({ page }) => {
  // Public UI checks remain reproducible without external services.
  await page.route(
    /cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com/,
    (route) => route.abort(),
  );
});

test("welcome page and keyboard-operated sign-in render without configuration", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "FYE family",
  );
  await expect(
    page.getByRole("status").filter({ hasText: "Live sign-in needs" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "View setup instructions" }),
  ).toHaveAttribute("href", /docs\/SETUP\.md$/);
  await page.locator("#open-signin").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(
    await page.evaluate(() =>
      document.querySelector(".login-dialog").contains(document.activeElement),
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("help is reachable from the application", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "FAQs & examples" }).click();
  await expect(page).toHaveURL(/help\.html$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Frequently asked questions",
  );
  await page.getByText("How do I find my mentor?", { exact: true }).click();
  await expect(
    page.locator("details").filter({ hasText: "How do I find my mentor?" }),
  ).toHaveAttribute("open", "");
});
