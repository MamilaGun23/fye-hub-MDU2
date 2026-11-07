const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("@playwright/test");
const { createApp } = require("../server");
const { parseCSV } = require("./demo/files.cjs");

// Private files contain only local configuration and test-account credentials.
for (const file of [".env", ".env.screenshots"]) {
  if (fs.existsSync(file)) process.loadEnvFile(file);
}
const loginSheet = process.env.FYE_SCREENSHOT_LOGINS_CSV;
let demoAccounts = [];
if (loginSheet) {
  const [headers, ...rows] = parseCSV(
    fs.readFileSync(loginSheet, "utf8").replace(/^\uFEFF/, ""),
  );
  demoAccounts = rows.map((row) =>
    Object.fromEntries(headers.map((header, index) => [header, row[index]])),
  );
}

async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      [...document.images].map((image) => image.decode().catch(() => {})),
    );
    for (const video of document.querySelectorAll("video")) video.pause();
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

(async () => {
  const output = path.join(__dirname, "../docs/screenshots");
  fs.mkdirSync(output, { recursive: true });
  const server = createApp().listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const baseURL = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    const selected = process.env.PLAYWRIGHT_CHANNEL;
    const channel =
      selected === "chromium"
        ? undefined
        : selected || (process.platform === "win32" ? "msedge" : undefined);
    browser = await chromium.launch({ channel });
    async function capture(page, name, fullPage = true) {
      await settle(page);
      await page.screenshot({
        path: path.join(output, `${name}.jpg`),
        type: "jpeg",
        quality: 65,
        fullPage,
        animations: "disabled",
      });
      console.log(`Captured actual app: ${name}`);
    }

    if (!process.argv.includes("--dashboards-only")) {
      const desktop = await browser.newPage({
        viewport: { width: 1280, height: 900 },
        reducedMotion: "reduce",
      });
      await desktop.goto(baseURL, { waitUntil: "networkidle" });
      await desktop.evaluate(() => window.fyeAuth.ready);
      await capture(desktop, "home-desktop");
      await desktop.locator("#open-signin").click();
      await desktop.locator(".login-dialog").waitFor({ state: "visible" });
      await capture(desktop, "sign-in");
      await desktop.goto(`${baseURL}/help.html`, { waitUntil: "networkidle" });
      await capture(desktop, "help");
      await desktop.close();

      const mobile = await browser.newPage({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        reducedMotion: "reduce",
      });
      await mobile.goto(baseURL, { waitUntil: "networkidle" });
      await mobile.evaluate(() => window.fyeAuth.ready);
      await capture(mobile, "home-mobile");
      await mobile.locator("#open-signin").click();
      await capture(mobile, "sign-in-mobile");
      await mobile.close();
    }

    for (const role of ["student", "mentor", "supervisor", "admin"]) {
      const requestedRole = process.argv
        .find((arg) => arg.startsWith("--role="))
        ?.slice(7);
      if (requestedRole && requestedRole !== role) continue;
      const prefix = `FYE_${role.toUpperCase()}`;
      const account = demoAccounts.find((account) => account.role === role);
      const email = process.env[`${prefix}_EMAIL`] || account?.email;
      const password = process.env[`${prefix}_PASSWORD`] || account?.password;
      if (!email || !password) {
        console.log(
          `Not captured: ${role} dashboard (test login not configured).`,
        );
        continue;
      }
      const context = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        reducedMotion: "reduce",
      });
      let page;
      let stage = "opening sign-in";
      try {
        console.log(`Signing in through the application: ${role}`);
        page = await context.newPage();
        await page.goto(baseURL, { waitUntil: "networkidle" });
        await page.locator("#open-signin").click();
        await page.locator("#email").fill(email);
        await page.locator("#password").fill(password);
        stage = "sign-in and role routing";
        await page.locator('#login-form button[type="submit"]').click();
        await page.waitForURL((url) => url.pathname.endsWith(`/${role}.html`), {
          timeout: 60000,
        });
        stage = "account readiness";
        await page.waitForFunction(
          () => document.body.dataset.authState === "ready",
        );
        stage = "dashboard data";
        // Polling dashboards can stay network-active after their content is ready.
        // Wait for actual rendered account/data state rather than network silence.
        await page.waitForFunction(
          (role) => {
            const selectors = {
              student: ["#student-greeting-name"],
              mentor: ["#mentor-header-name", "#mentor-student-count"],
              supervisor: [
                "#student-count",
                "#mentor-count",
                "#assignment-count",
              ],
              admin: [
                "#admin-profile-name",
                "#admin-total-users",
                "#admin-academic-summary",
              ],
            }[role];
            return selectors.every((selector) => {
              const value = document
                .querySelector(selector)
                ?.textContent.trim();
              return (
                value &&
                !/loading|checking|unavailable/i.test(value) &&
                value !== "—" &&
                !["Student", "Mentor", "Admin"].includes(value)
              );
            });
          },
          role,
          { timeout: 60000 },
        );
        await page.locator(".main-content").waitFor({ state: "visible" });
        await capture(page, `${role}-dashboard`);
        {
          const feature = {
            student: "mentor",
            mentor: "students",
            supervisor: "assignments",
            admin: "analytics",
          }[role];
          stage = `${feature} view`;
          await page.locator(`[data-view="${feature}"]`).click();
          await page
            .locator(`[data-page="${feature}"]`)
            .waitFor({ state: "visible" });
          await page.waitForFunction(
            (selector) =>
              !/loading[.\s…]/i.test(
                document.querySelector(selector)?.innerText || "",
              ),
            `[data-page="${feature}"]`,
          );
          await capture(page, `${role}-${feature}`, false);
          stage = "mobile dashboard";
          await page.locator('[data-view="overview"]').click();
          await page.setViewportSize({ width: 390, height: 844 });
          await page.evaluate(
            () =>
              new Promise((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(resolve)),
              ),
          );
          await capture(page, `${role}-mobile`);
        }
      } catch {
        if (page) {
          fs.mkdirSync(".demo-seed", { recursive: true });
          await page
            .screenshot({
              path: `.demo-seed/capture-${role}-failure.jpg`,
              mask: [page.locator("input")],
            })
            .catch(() => {});
        }
        // Never print an exception which might contain credentials or session URLs.
        throw new Error(
          `The ${role} capture stopped at ${stage}. Check the private failure screenshot in .demo-seed/.`,
        );
      } finally {
        await context.close();
      }
    }
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
