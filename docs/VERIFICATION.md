# Portfolio verification

Checked **7 November 2026**, using Node.js 24 and installed Microsoft Edge on Windows. Browser checks run with empty Supabase configuration and synthetic explanatory content. No live database writes, seed operations, or migrations were performed.

## Results

| Check | Result | What it establishes |
| --- | --- | --- |
| Node regression suite | 133 passed, 0 failed | Existing workflow regressions plus public runtime-config behavior |
| Portfolio browser suite | 6 passed, 0 failed | Three checks each at desktop and mobile sizes |
| Dependency audit | 0 reported vulnerabilities | Audit result after compatible transitive dependency updates |
| Presentation captures | Desktop, mobile, and app entry screen generated | Screenshots from the local implementation |
| Source review | Original MIT licence and repository history preserved | Portfolio additions retain existing attribution |

## Browser story

The reviewer opens the portfolio page, selects each of four roles, reads its responsibilities, and follows the case study and repository links. No account or backend connection is required.

- At 1440 × 1000 and 390 × 844, all four role buttons update content and exactly one remains selected.
- No Supabase or runtime-config requests occur from the portfolio page.
- No uncaught page errors occur in the checked flows.
- There is no horizontal page overflow at either tested width.
- The skip link receives keyboard focus, Enter activates a role button, and reduced-motion preference disables smooth scrolling.
- Without configured Supabase values, the app landing page displays a setup message and the walkthrough link works, even if the Supabase CDN is unavailable.

## Server story

Runtime tests start the Express app on an ephemeral local port and request `/runtime-config.js`. They verify valid JavaScript, the public URL/key allowlist, omission of administrative credentials, `Cache-Control: no-store`, blank configuration handling, a readable portfolio route, and a 404 for `/.env`.

## Reproduction

```sh
npm ci
npm test
npx playwright install chromium
npm run test:portfolio
npm run screenshots
npm audit
```

Windows checks default to installed Edge; other systems use Playwright Chromium. The regression command limits concurrency to two to keep the isolated PostgreSQL and DOM fixtures manageable on a development machine. Text attributes use LF endings so source-based fixtures work consistently across platforms.

## Limits

The regression suite includes isolated database-contract and mocked DOM checks. It does not certify the state of a deployed Supabase project. Live sign-in, real role credentials, deployed RLS/storage policies, actual email delivery, and migration installation were not tested in this portfolio pass. No user adoption or educational impact measurements are claimed.

The six browser checks cover the new portfolio and unconfigured landing flow, not every authenticated dashboard or a full accessibility audit. A fresh database still requires a reviewed base schema that is not included in this repository. Dependency audit results describe this check, not a permanent guarantee.
