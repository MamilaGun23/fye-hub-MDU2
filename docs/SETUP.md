# Setup

## Requirements

- Node.js 22 or newer.
- A compatible Supabase project with Auth, Storage, profiles, and the application schema.

The SQL files extend an existing database. A complete base schema for a fresh Supabase project is not yet included; see [database notes](../database/README.md).

## Start the application

```sh
git clone https://github.com/MamilaGun23/fye-hub-MDU2.git
cd fye-hub-MDU2
npm ci
```

Copy `.env.example` to `.env` and set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`. Use the public browser key; administrative credentials belong in the separate `.env.demo` file used by [demo tooling](../scripts/demo/README.md).

```sh
npm start
```

Open **http://localhost:3000**. The start command loads `.env`; restart the server after changing it. `PORT` defaults to `3000`.

## Validation

```sh
npm test
npx playwright install chromium
npm run test:e2e
```

Browser checks use installed Edge on Windows and Playwright Chromium elsewhere. Set `PLAYWRIGHT_CHANNEL=chromium` to use the bundled browser on Windows. Tests use isolated fixtures and do not certify a deployed database's policies.

## Screenshots

`npm run screenshots` captures the actual application. Set `FYE_SCREENSHOT_LOGINS_CSV` in the ignored `.env.screenshots` file to use an existing demo-login CSV with `role`, `email`, and `password` columns. It captures desktop and mobile workspaces through normal sign-in and writes images to `docs/screenshots/`.

Keep credentials and CSV files outside source control. Use demo records suitable for publication.
