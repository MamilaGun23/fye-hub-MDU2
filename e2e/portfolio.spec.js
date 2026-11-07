const { test, expect } = require("@playwright/test");

test("all four journeys work without a backend and fit the viewport", async ({
  page,
}) => {
  const failures = [];
  const backendRequests = [];
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("request", (request) => {
    if (/supabase|runtime-config/.test(request.url()))
      backendRequests.push(request.url());
  });
  await page.goto("/portfolio.html");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "connection",
  );
  for (const [role, heading] of [
    ["Mentor", "Turn experience into guidance."],
    ["Supervisor", "Connect people. Guide the programme."],
    ["Admin", "Give the community a solid foundation."],
    ["Student", "Your support network, in one place."],
  ]) {
    const button = page.getByRole("button", { name: role, exact: false });
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('[data-role][aria-pressed="true"]')).toHaveCount(
      1,
    );
    await expect(page.locator("#role-title")).toHaveText(heading);
    await expect(page.locator(".feature-card")).toHaveCount(3);
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(backendRequests).toEqual([]);
  expect(failures).toEqual([]);
});

test("keyboard and reduced-motion navigation remain usable", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/portfolio.html");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to content" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await page.locator('[data-role="mentor"]').focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#role-label")).toHaveText("MENTOR WORKSPACE");
  expect(
    await page.evaluate(
      () => getComputedStyle(document.documentElement).scrollBehavior,
    ),
  ).toBe("auto");
});

test("unconfigured app explains setup and links to the walkthrough", async ({
  page,
}) => {
  const failures = [];
  page.on("pageerror", (error) => failures.push(error.message));
  // Keep this test independent of external CDN availability.
  await page.route(
    /cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com/,
    (route) => route.abort(),
  );
  await page.goto("/");
  await expect(
    page.getByRole("status").filter({ hasText: "Live sign-in needs" }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Explore the portfolio walkthrough" })
    .click();
  await expect(page).toHaveURL(/portfolio\.html$/);
  expect(failures).toEqual([]);
});
