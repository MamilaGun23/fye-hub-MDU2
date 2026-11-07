const { defineConfig } = require("@playwright/test");
const selected = process.env.PLAYWRIGHT_CHANNEL;
const channel =
  selected === "chromium"
    ? undefined
    : selected || (process.platform === "win32" ? "msedge" : undefined);

module.exports = defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  use: {
    baseURL: "http://127.0.0.1:3100",
    channel,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
    {
      name: "mobile",
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: {
    command: "node server.js",
    url: "http://127.0.0.1:3100/portfolio.html",
    env: { PORT: "3100", SUPABASE_URL: "", SUPABASE_PUBLISHABLE_KEY: "" },
    reuseExistingServer: false,
  },
});
