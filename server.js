const express = require("express");
const path = require("path");

function createApp(env = process.env) {
  const app = express();
  app.disable("x-powered-by");

  // These two values are public browser configuration, never service-role keys.
  app.get("/runtime-config.js", (_req, res) => {
    const config = {
      supabaseUrl: env.SUPABASE_URL || "",
      supabasePublishableKey: env.SUPABASE_PUBLISHABLE_KEY || "",
    };
    res.type("application/javascript").set("Cache-Control", "no-store");
    res.send(`window.FYE_CONFIG = ${JSON.stringify(config)};`);
  });

  app.use(express.static(path.join(__dirname, "public")));
  return app;
}

if (require.main === module) {
  const port = process.env.PORT || 3000;
  createApp().listen(port, () => {
    console.log(`FYE Hub is running at http://localhost:${port}`);
    console.log(
      `Portfolio walkthrough: http://localhost:${port}/portfolio.html`,
    );
  });
}

module.exports = { createApp };
