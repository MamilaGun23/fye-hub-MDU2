const { chromium } = require("@playwright/test");
const { createApp } = require("../server");
const fs = require("node:fs");

(async () => {
  const server = createApp({}).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  let browser;
  try {
    const selected = process.env.PLAYWRIGHT_CHANNEL;
    const channel =
      selected === "chromium"
        ? undefined
        : selected || (process.platform === "win32" ? "msedge" : undefined);
    browser = await chromium.launch({ channel });
    fs.mkdirSync("docs/assets", { recursive: true });
    for (const [name, viewport] of [
      ["desktop", { width: 1200, height: 900 }],
      ["mobile", { width: 390, height: 844 }],
    ]) {
      const page = await browser.newPage({
        viewport,
        deviceScaleFactor: 1,
        reducedMotion: "reduce",
      });
      await page.goto(
        `http://127.0.0.1:${server.address().port}/portfolio.html`,
        { waitUntil: "networkidle" },
      );
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({
        path: `docs/assets/portfolio-${name}.jpg`,
        fullPage: true,
        type: "jpeg", quality: 55,
      });
      await page.close();
      console.log(`Captured docs/assets/portfolio-${name}.jpg`);
    }
    const landing = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: "reduce",
    });
    await landing.route(/cdn\.jsdelivr\.net/, (route) => route.abort());
    await landing.goto(`http://127.0.0.1:${server.address().port}/`, {
      waitUntil: "networkidle",
    });
    await landing.evaluate(async () => {
      await document.fonts.ready;
      document.querySelectorAll("video").forEach((video) => video.pause());
    });
    await landing
      .locator(".welcome")
      .screenshot({ path: "docs/assets/application-landing.jpg" });
    await landing.close();
    console.log("Captured docs/assets/application-landing.jpg");
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
