# Demo data tools

Local tools for auditing a compatible Supabase project, preparing fictional cohorts, and managing tracked demo accounts. They are separate from the application runtime.

## Preparation

1. Run `database/DEMO_READ_ONLY_AUDIT.sql` against the target project and save its exported JSON or CSV locally.
2. Import the audit and review the generated programme classifications.
3. Generate and inspect a batch preview before any live seeding.

```sh
npm run demo:audit -- --input .demo-seed/audit-export.json
npm run demo:preview -- --batch presentation-2026
npm run demo:check -- --batch presentation-2026
```

Private audits, plans, manifests, and login exports are stored under ignored `.demo-seed/`.

## Live operations

Requires the compatible database migrations and local `.env.demo` configuration containing the target Supabase URL and administrative key. Keep administrative credentials outside `public/` and source control.

| Command | Purpose |
| --- | --- |
| `npm run demo:seed -- --batch <name>` | Create or resume a tracked fictional cohort |
| `npm run demo:verify -- --batch <name>` | Check provisioned accounts and scenario records |
| `npm run demo:access -- --batch <name>` | Verify access using selected role accounts |
| `npm run demo:trial -- --batch <name> --programme <id>` | Run a one-programme trial |
| `npm run demo:cleanup -- --batch <name>` | Preview removal of tracked demo records |
| `npm run accounts:refresh -- --batch <name>` | Preview presentation updates to existing demo identities |

Cleanup and account refresh use `--execute` to apply their previews. Seeding is resumable and uses protected ownership metadata; existing untracked accounts are not eligible for cleanup. Review migration prerequisites in [database notes](../../database/README.md).
