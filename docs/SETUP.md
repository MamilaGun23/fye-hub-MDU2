# Local setup

## Portfolio walkthrough — no accounts required

Install Node.js 22 or newer and Git, then:

```sh
git clone https://github.com/MamilaGun23/fye-hub-MDU2.git
cd fye-hub-MDU2
npm ci
npm start
```

Open **http://localhost:3000/portfolio.html**. The four role buttons change the explanatory content locally. No live records, accounts, or Supabase requests are involved.

If PowerShell blocks `npm.ps1`, use `npm.cmd` in place of `npm`.

## Live application

The app needs a compatible existing Supabase project. A complete base database schema is not included; the migration files are not an empty-database installer.

1. Copy `.env.example` to `.env`.
2. Set `SUPABASE_URL` to your own project URL and `SUPABASE_PUBLISHABLE_KEY` to its public/publishable browser key. Leave `SUPABASE_SERVICE_ROLE_KEY` empty in this app file.
3. Run `npm start`. The start script loads `.env` with Node's native environment-file support. Restart after changing configuration.
4. Open **http://localhost:3000**. Supabase Auth, compatible profile provisioning, and the required schema/policies must already exist before sign-in works.

`PORT` defaults to `3000`. The server's `/runtime-config.js` endpoint exposes only the URL and publishable key. These are browser-visible configuration values; data protection relies on database and storage policies. Never put a service-role or secret key in the publishable-key field.

Without configuration, the landing page shows a setup notice and links to the portfolio walkthrough. This state does not prevent reading the walkthrough.

## Database prerequisites and migrations

Foundational tables include profiles, faculties, programmes, mentor assignments, calendar events, and system notices, plus Supabase Auth and storage setup. Existing migrations add workflow functions, policies, academic-cycle records, notifications, messaging, attendance, and audit records.

The exact base schema, provisioning triggers, policies, extensions, and storage configuration must be exported and reviewed from an authorised project before attempting a fresh installation. Table names alone are not a sufficient schema contract.

For an existing matching prototype database, consult [database/DEMO_DEPLOYMENT.md](../database/DEMO_DEPLOYMENT.md), [database/DASHBOARD_UPDATES.md](../database/DASHBOARD_UPDATES.md), and [scripts/demo/README.md](../scripts/demo/README.md). Treat those as existing-project operational notes, not general setup commands.

**Do not rerun `RUN_ALL_LATEST_CHANGES.sql` as a bootstrap.** It contains `DROP TABLE ... CASCADE` operations for messaging and contact records. The historical communication migration also rebuilds those tables. Review migrations and backups before applying them to a database containing records. The combined demo installer assumes earlier foundational migrations already exist.

This portfolio update does not execute migrations, seed accounts, or change a live database.

## Optional administrative demo tooling

Use a separate `.env.demo` for administrative seed tools. A service-role key is for local administrative tooling only. Follow the [existing demo tooling guide](../scripts/demo/README.md) and inspect offline audits/previews before any live operation. Demo target account counts are planned fixtures, not adoption statistics.

## Checks and screenshots

```sh
npm test
npx playwright install chromium
npm run test:portfolio
npm run screenshots
```

The browser checks start a local server on port 3100 with blank Supabase configuration. They use Edge on Windows and Playwright Chromium elsewhere. `PLAYWRIGHT_CHANNEL` can select another installed channel; `chromium` selects Playwright's bundled browser.

`npm run screenshots` captures the actual application with the configured Supabase client and writes images to `docs/screenshots/`. Optional test-account logins in the ignored `.env.screenshots` enable dashboard captures through the real sign-in form. See [the screenshot guide](SCREENSHOTS.md). The capture script starts and stops its own local server.

`npm run screenshots:portfolio` captures the independent explanatory presentation and writes its images to `docs/assets/`.
