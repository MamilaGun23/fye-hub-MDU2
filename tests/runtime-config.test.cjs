const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { createApp } = require("../server");

test("runtime config exposes only public values and never caches them", async (t) => {
  const server = createApp({
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_example",
    SUPABASE_SERVICE_ROLE_KEY: "private-administrative-key",
  }).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${base}/runtime-config.js`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(response.headers.get("content-type"), /javascript/);
  const source = await response.text();
  assert.ok(!source.includes("private-administrative-key"));
  const context = { window: {} };
  vm.runInNewContext(source, context);
  assert.equal(
    context.window.FYE_CONFIG.supabaseUrl,
    "https://example.supabase.co",
  );
  assert.equal(
    context.window.FYE_CONFIG.supabasePublishableKey,
    "sb_publishable_example",
  );
  assert.equal(Object.keys(context.window.FYE_CONFIG).length, 2);
  assert.equal((await fetch(`${base}/.env`)).status, 404);
  assert.equal((await fetch(`${base}/`)).status, 200);
});

test("no configuration produces valid blank browser configuration", async (t) => {
  const server = createApp({}).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/runtime-config.js`,
  );
  const context = { window: {} };
  vm.runInNewContext(await response.text(), context);
  assert.equal(context.window.FYE_CONFIG.supabaseUrl, "");
  assert.equal(context.window.FYE_CONFIG.supabasePublishableKey, "");
});
