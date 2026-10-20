# Demo deployment

Code and seed preparation are separate from live installation/population. The
offline audit has been imported. The generated named-batch preview is private:
`.demo-seed/presentation-2026/preview.csv`, with summary/counts in the same folder.

The reviewed catalogue has **32 programmes**. The plan creates **1,600 Student-role
accounts, 64 extra mentors and two extra demo staff accounts**: 1,666 Auth accounts
in total. Existing users do not count toward these targets and keep their passwords.
The 25 entry-level programmes receive 30 first-time students and 20 returning
students; the seven Advanced Diplomas receive 50 returning students. Every
programme additionally receives two approved returning mentor accounts.

The user explicitly chose to keep the catalogue and treat the manually named
medicine programme as a six-year prototype qualification. No honours/postgraduate
programmes were added. Qualification/mapping workflows support them when added
to the catalogue. UMP programme durations were reviewed against the
[2026 Almanac, pages 18–20](https://www.ump.ac.za/getattachment/Study-with-us/Almanac/UMP-Almanac-2026.pdf.aspx?lang=en-US).
The medicine setting is a prototype choice, not a claim about UMP's offerings.

## Install

Run **`database/DEMO_INSTALL.sql`** in this prototype project's Supabase SQL Editor
as `postgres`. This combines eight migrations into one transaction:

1. `20261019000000_academic_lifecycle.sql`: declared/verified academic details,
   cycle-aware mentor applications, evidence history, appointments, mappings and
   annual assignment expiry. Existing assignments without a reviewed academic year
   remain available until supervisor review; no years are guessed. Reviewed and
   new assignments expire at the end of their recorded academic year.
2. `20261019010000_demo_cohort_and_seeding.sql`: protected demo membership,
   audience boundaries, record registry, restricted seed/report/cleanup RPCs.
3. `20261019020000_academic_clients_and_analytics.sql`: appointment authority,
   message/contact fixes, five aligned analytics cohorts and programme classification.
4. `20261019030000_reviewed_programme_qualifications.sql`: guarded classification
   of the exact 32 audited programmes, without adding/renaming/deleting programmes.
5. `20261019040000_demo_workflows_and_schedule.sql`: normal-workflow idempotency,
   restricted historical events/attendance and the minute-by-minute reconciliation job.
6. `20261019050000_dashboard_read_performance.sql`: cached staff permission checks
   and an active-mentor assignment index for full-population directory reads.
7. `20261020000000_update_titles.sql`: selected update titles in supervisor
   notifications, including existing notifications with the old generic heading.
8. `20261020010000_natural_account_labels.sql`: student-number UMP addresses,
   natural staff addresses and faculty labels, while retaining protected ownership,
   legacy batch resume, audience boundaries and cleanup tracking.

Use the combined install or these eight files in order, not both. Do not rerun
`RUN_ALL_LATEST_CHANGES.sql`: it contains older destructive table rebuilds.
pg_cron is already present in the exported database. The installer registers
`fye-academic-lifecycle` without replacing the notice-expiry job.

The frontend now requires these migrations. Deploy/reload the updated frontend
after installing the SQL. Rebuilding the install file after editing a migration:

```powershell
& 'C:\Program Files\nodejs\node.exe' scripts/demo/build-install.cjs
```

## Populate and verify

Copy `.env.example` to `.env.demo` and configure the project URL and administrative
key **locally**, never in chat or public assets. See `scripts/demo/README.md` for
the complete behavior and optional trial/cleanup commands.

```powershell
& 'C:\Program Files\nodejs\node.exe' scripts/demo/cli.cjs check --batch presentation-2026
& 'C:\Program Files\nodejs\node.exe' scripts/demo/cli.cjs seed --batch presentation-2026
& 'C:\Program Files\nodejs\node.exe' scripts/demo/cli.cjs verify --batch presentation-2026
& 'C:\Program Files\nodejs\node.exe' scripts/demo/cli.cjs access --batch presentation-2026
```

`seed` covers all programmes. It stops before account creation if the live
migration contract or catalogue does not match. Twelve-account batches use at most
three concurrent requests and checkpoint each record. Resume with the same command.
Do not delete the private manifest or regenerate passwords to resume.
The current seed contract is version 2. If an earlier saved installer was run,
rerun the current file before seeding; the installer is tested to preserve
existing applications/history and never reactivate ended mentor appointments.
If the first five migrations are already installed, apply only
`20261019050000_dashboard_read_performance.sql` for the directory correction.
Preflight also requires its `directory_reads` readiness flag.
If all six 19 October migrations are already installed, apply only
`20261020000000_update_titles.sql` for the project-wide update title correction.
It preserves historic titles and content while keeping the demo schema contract
current. Reload the frontend to load the shared sign-in and dashboard wording.
If the update-title migration is also installed, apply only
`20261020010000_natural_account_labels.sql` for future natural account and event
seeding. This upgrade preserves existing account addresses, passwords and content;
it does not rewrite frozen plans or manifests.

Selected presentation credentials are written to
`.demo-seed/presentation-2026/presentation-logins.csv`. Existing staff credentials
cannot be retrieved from Supabase; no existing account password is reset. The
additional marked demo admin/supervisor accounts demonstrate notification workflows
without sending seeded notifications to pre-existing staff.
Newly generated student and mentor accounts use `<student_number>@ump.ac.za`.
Staff use ordinary named UMP addresses. Display names, faculty labels, documents
and event text contain no demonstration markers; internal batch metadata remains
protected for audience isolation and tracked cleanup. An existing unmarked
account is never adopted when its email matches a proposed account.

The completed demonstration includes current pending/shortlisted/declined
applications, 24 matched mentees per entry-level programme (six left unassigned),
historical returning-mentor approvals, faculty events, eight attendance records
per faculty, pending/approved/completed cancellation flow, notices and messages.
New demo updates use the same **University update** and **Application updates**
title choices as the admin form. Existing seeded content is preserved on resume.
Current first-year candidates are never approved early. Outside October–January,
the normal application scenario submissions are skipped; the API window is not bypassed.

`verification.json` reports the result. Do not call the live load complete until
verification passes and selected logins work. The private files are not served by
Express and are ignored by source control.

`access-verification.json` separately records real-role dashboard access:
analytics/detail totals, faculty calendar boundaries, full staff directories,
mentor evidence and privilege denials. The `access` command can diagnose the
installation without seeding or resetting accounts. Missing directory SQL blocks
the expensive affected reads while independent checks continue. Seed/full verify
now require both population and access verification before recording completion.

## Remove a demo batch later

```powershell
& 'C:\Program Files\nodejs\node.exe' scripts/demo/cli.cjs cleanup --batch presentation-2026
# Inspect .demo-seed/presentation-2026/cleanup-preview.json first.
& 'C:\Program Files\nodejs\node.exe' scripts/demo/cli.cjs cleanup --batch presentation-2026 --execute
```

Cleanup checks ownership and foreign references, removes only tracked rows/Storage
objects/Auth accounts, and refuses when existing data references demo accounts.
Manual edits are preserved on resume; verification reports material changes instead
of silently restoring the original seed values.
