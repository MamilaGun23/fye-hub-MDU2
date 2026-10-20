# FYE Hub handoff — 18 October 2026

## Inspection and scope

The latest attached Antigravity conversation requested scrollable dashboard navigation, a faculty/programme analytics breakdown, and a cleaner academic management section. Those implementations were already present and were retained. This pass completed integration gaps and repaired a pre-existing supervisor script failure.

This workspace has no `.git` directory, so a commit-based diff or attribution of earlier edits is unavailable. No reset, checkout, database migration, or deployment was performed.

Older Antigravity notes were found in:

- `C:/Users/Tshifhiwa/.gemini/antigravity-cli/brain/61f9b1c9-84d1-4073-a2bc-0476e48c4ccd/implementation_plan.md`
- `C:/Users/Tshifhiwa/.gemini/antigravity-cli/brain/61f9b1c9-84d1-4073-a2bc-0476e48c4ccd/fye_hub_system_analysis_and_development_plan.md`

These are planning documents, not an up-to-date completion checklist. Their larger proposals need separate prioritisation.

## Previously implemented and retained

- Shared sidebar vertical scrolling; admin faculty analytics tabs and programme counts.
- Faculty Rename/Delete buttons, grouped programme lists, and programme deletion.
- Student UI for shortlisted mentor applications (`student.js`).
- SQL definitions for manual student assignment, faculty deletion, and manual attendance (`database/20261008000000_assignment_and_academic_rpcs.sql`, also included in `RUN_ALL_LATEST_CHANGES.sql`). These exist locally; execution against Supabase is unverified.
- QR code dependencies on student, mentor, and supervisor pages.
- Supervisor notification read/unread RPC names and existing footer links/styles.

## Completed in this pass

- Kept sidebar contents from shrinking on short screens and exposed Sign out on mobile across dashboards.
- Preserved all table columns on mobile with horizontal scrolling.
- Added accessible faculty tab selection and arrow/Home/End keyboard navigation; retained the selected faculty during refresh.
- Matched analytics account-state counts to the existing account list's handling of `is_active`.
- Loaded admin profiles in pages instead of relying on a single limited API response; failed loads show an unavailable state rather than presenting partial totals.
- Refreshed the faculty breakdown after academic edits, account activation changes, and mentor deletion. Preserved valid user-list filters and programme-form faculty selection.
- Sorted academic management groups by faculty and stacked row actions on narrow screens.
- Repaired duplicated state and a malformed rendering block in `supervisor.js` that prevented parsing. Removed repeated/recursive wrappers and attached listeners once.
- Restored supervisor student pagination, debounced search, reset/empty-result counts, and functioning mentor faculty/programme filters.
- Replaced the supervisor's in-memory mock contact action with a validated saved WhatsApp group link. Student detail fields render as text.
- Repaired the supervisor mentor panel's missing opening article and table column counts.
- Added dependency-free regression checks using Node's test runner (`npm test`).

## Remaining work from the broader roadmap

- Reproducible base database schema: existing migrations assume foundational tables and signup/profile provisioning already exist. Export and compare the deployed schema before constructing a baseline.
- Verify migration deployment, RLS permissions, and CRUD/assignment flows with authorised test accounts. In particular, programme deletion currently relies on deployed database policies and foreign-key behaviour.
- Manual attendance now has both a SQL function and a supervisor form (see the follow-up below); deployment and live permission checks remain outstanding.
- Messaging still polls every 10 seconds; notifications also poll. Realtime subscriptions are a future enhancement.
- Background scheduling for overdue contact alerts and external email/push delivery are not implemented in this repository.
- PDF export still uses a custom ASCII-oriented builder; Unicode-preserving export remains unfinished.
- Native camera QR scanning and the optional mentor capacity chart remain roadmap items.
- Live browser checks of responsive layouts, keyboard interactions, and signed-in workflows remain outstanding.

## Validation

All seven regression tests passed. All browser JavaScript files and `server.js` passed `node --check`. HTTP smoke checks returned 200 for the landing page, both updated dashboards, and their checked assets. All HTML files passed duplicate-ID and local-resource checks. The automated tests use a DOM fixture and mocked query results; they do not verify actual browser layout or live Supabase security policies.

Node is installed at `C:/Program Files/nodejs/node.exe`, but this session's PATH did not expose `node`, `npm`, or `git`. Commands can use the absolute Node path, or a fresh shell with Node on PATH.

## Follow-up implementation — 18 October 2026

Re-read the existing handoff and Antigravity supervisor plan and verified that all seven earlier regression tests still passed before editing. The newer Antigravity artifact under `brain/186adee0-c196-40fd-b1ca-c218b2247580/.system_generated/steps/87/content.md` was an admin page snapshot, not a new task plan. There is still no Git metadata in this workspace.

Completed the next functional gaps:

- Added `public/manual-attendance.js`, loaded before `event-workflow.js` on the supervisor page. Each scheduled/completed event now includes a manual attendance section. It loads active students and mentors in pages, supports name/email/student-number search, and excludes existing valid check-ins while allowing invalidated records to be corrected.
- Required an audit reason, checked the scheduled event window on render and submit, prevented duplicate submissions, and refreshed attendance counts and audit history after saving. Errors preserve the form inputs; a refresh failure after saving is distinguished from a failed save. Database validation remains authoritative.
- Added supervisor **Mark all as read**. A new recipient-scoped, active-supervisor-only RPC handles the entire inbox atomically. The unread badge now counts the entire inbox and displays `99+` when necessary. The existing notifications page and per-item controls remain available.
- Corrected the overdue-contact notification action label to **View students**.
- Added seven regression checks for manual attendance and notification bulk-read behaviour. Fourteen total tests pass, including the seven earlier tests.
- JavaScript syntax checks passed. HTTP smoke checks returned 200 for the supervisor page and all four checked assets; HTML IDs/local resources and the combined SQL file's inclusion of the new migration were also checked.

### Database steps still required

The form uses `record_manual_event_attendance` from `20261008000000_assignment_and_academic_rpcs.sql`. Confirm that migration is already deployed before using manual check-in. Bulk notification read additionally requires `20261009000000_supervisor_notification_bulk_read.sql`, which is also appended to `RUN_ALL_LATEST_CHANGES.sql`. No live database changes were made. Apply the individual new migration to an existing deployment; the combined file contains earlier changes and is not a replacement for the missing baseline schema.

### Remaining roadmap and validation

The baseline schema, live RLS/workflow verification, realtime messaging, background scheduling, Unicode PDF export, native camera scanner, and optional capacity chart remain unfinished. Antigravity's notification dropdown is also still a proposal; this pass completed bulk-read controls within the existing inbox view. Browser layout and signed-in Supabase checks still require a live environment.

## Requested dashboard refinements — 18 October 2026

Implemented the requested supervisor/admin changes while retaining the earlier work:

| Request | Implementation |
| --- | --- |
| Shortlisted mentor candidates | Separate final-review table with current shortlist count and approval/decline actions. |
| Cleaner active matches | Mentor cards show counts and capacity; assigned students and the full matches table remain collapsed until opened. |
| Approved events leave requests | Pending requests remain in Event request; published-event controls and attendance move to Event calendar. |
| Admin and supervisor attendance | QR token, published event and attendance records share the same event ID. Supervisor and admin views distinguish student attendance from total valid check-ins. Admin can inspect/export attendee records. |
| Mentor cancellation requests | Mentor submits a reason; supervisor approves/declines. Approved requests link to the calendar, where removal completes cancellation, clears reminders and notifies affected students and mentors. History is retained. |
| Faculty event access | Requests inherit the mentor's faculty. Database policies restrict calendar visibility; notification and attendance rules enforce the same faculty. Existing university events remain university-wide. Legacy faculty events with missing faculty data are withheld from students. |
| Distinct event icon | Flag icon for Event request; grid icon for Event calendar. |
| Programme account access | Student/mentor counts expand into names that open account details. Account names in the user list and analytics records open the same viewer. |
| Linked analytics and reports | Every highlighted metric opens its detail records and has an individual CSV report button. Report cohorts match summary totals. CSV preserves Unicode and escapes spreadsheet formulas. |
| Notice duration and expiry | End date/time or 1–365 day duration. Banners expire on open pages, analytics exclude expired records immediately, and a pg_cron sweep clears active flags every minute. |
| Three-dot actions | Academic Rename/Delete, account controls, application reviews, event edits/reviews and attendance corrections are hidden in keyboard-accessible action menus. |

The approval RPC also now uses the calendar's numeric event ID type. The legacy notification-copy trigger was reconciled with faculty fanout so it does not duplicate messages or consume the requesting mentor's QR notification.

### Deployment

Apply `database/20261010000000_faculty_events_and_dashboard_details.sql` after the existing migrations through `20261009000000`. It runs in a transaction and is included in the combined SQL file. For automatic expiry with no dashboards open, enable **pg_cron**, then apply `database/20261011000000_notice_expiry_schedule.sql` separately. No live SQL was executed.

See [database/DASHBOARD_UPDATES.md](database/DASHBOARD_UPDATES.md) for the workflow descriptions, migration order and live verification steps. Use individual new migrations to upgrade the existing deployment; the combined file includes destructive statements from older migrations and is not a script to rerun blindly.

### Validation and limits

The test suite now includes the original regression tests, eight DOM workflow tests using jsdom, and PostgreSQL tests using PGlite. Database tests execute the migration, RLS policies, QR check-in, cancellation workflow, analytics detail cohorts and expiry logic against an isolated schema fixture. Scheduler registration is checked with a stub; actual pg_cron execution and Supabase Realtime delivery need live verification. These test libraries are development-only dependencies.

All 32 tests passed. All public JavaScript files passed syntax checks. HTTP smoke checks returned 200 for all three affected dashboards and their checked assets; HTML ID/local-resource checks and migration-bundle consistency checks passed.

Visual layout and signed-in workflows against the deployed database remain unverified. The unrelated baseline-schema, realtime messaging, mentor-alert scheduling, Unicode PDF and native QR-camera roadmap items remain outstanding.

### Notice scheduler setup correction

The reported empty `expire_system_notices` result is expected for a function returning `VOID`. The scheduler's `schema "cron" does not exist` error indicates that pg_cron had not been enabled. Updated `20261011000000_notice_expiry_schedule.sql` to run `CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog` before scheduling. Run this migration as postgres in the Supabase SQL editor. Its scheduler contract test still uses a stub because PGlite does not provide the pg_cron extension itself; extension installation remains a live deployment check.

## Prototype population planning — 19 October 2026

The user wants at least 50 students per programme, including returning students across undergraduate and postgraduate qualifications, for a prototype presentation. They explicitly confirmed that **only first-time undergraduate students should receive mentor matches**.

Recorded the proposed population, academic model, assignment restrictions, implementation sequence and acceptance checks in [DEMO_DATA_PLAN.md](DEMO_DATA_PLAN.md). First-time status must be separate from qualification level and study year; returning Year 1 and postgraduate Year 1 students must not become FYE mentees. Preserve existing same-faculty/programme matching and the 20-student mentor capacity. Review existing assignments rather than removing them automatically.

This is planning only. No seeder, eligibility migration, account creation, live data change or modification to application behaviour has been performed for this task yet. The deployed catalogue/schema and presentation environment still need to be established before implementation and population.

### Confirmed recruitment and demo identity rules

The user added and clarified these requirements on 19 October 2026; they are incorporated in `DEMO_DATA_PLAN.md`:

- Mentor applications for everyone open 1 October and close at the end of 31 January (Johannesburg time).
- First-year entrants can apply in that window. Approval must wait until the following calendar year and verification of published final first-year results.
- Returning students at any qualification level can apply in the same window; replace the current blanket Year-2-or-above restriction.
- New January entrants wait until October. The previous year's first-year cohort may still apply through January 31 in the preceding October's cycle. This was explicitly confirmed by the user.
- On-time first-year applicants may upload final results later, even after January 31 if results are delayed. This was explicitly confirmed by the user. Review/approval of submitted applications can continue after submissions close.
- Demo student numbers follow the user's nine-digit example: first two digits identify original university first-entry year, followed by seven unique digits. Keep a separate full entry year; do not infer current study year or first-time eligibility solely from the prefix.
- Demo names must represent South African official-language communities, with SASL represented through separate language preferences and written names from varied backgrounds.

No application code, SQL migration or seed accounts were changed for these planning refinements. Implementation must update the existing application constraints, triggers/RPCs, year-based UI restrictions, required-PDF workflow and one-application-per-user design together.

### Plan gap review

Reviewed the plan against the current login/mentor approval helpers, application constraints, matching RPCs and academic-record policies. Added a gap review to `DEMO_DATA_PLAN.md`. Decisions still needed include mentor term/renewal, academic acceptance criteria, final results-completion and correction rules, postgraduate-to-undergraduate mentor mapping, trusted cohort classification, year rollover and application withdrawal/resubmission transitions. Also recorded provisioning recovery, trigger-generated notifications, cleanup dependencies, count definitions, pagination, language-pool validation and presentation-date constraints. Proposed defaults remain recommendations, not confirmed policy. This review changed documentation only.

### All 20 form answers confirmed — 19 October 2026

Consolidated the user's answers into `DEMO_DATA_PLAN.md`, replacing the unresolved recommendations. Key choices overriding earlier suggestions: mentor appointments continue until a supervisor ends them (no annual reapplication); mentee assignments automatically end December 31 with history retained; postgraduate mentors may receive explicit same-faculty undergraduate programme mappings.

Other confirmed rules: first-year approval requires progression to Year 2 and new-year registration; returning applicants supply latest results and current registration; supplementary results keep applications pending; results completion closes March 31 with recorded extensions; document replacement resets pre-approval verification or requires post-approval review. New appointments start in the following academic year. Supervisors verify declared eligibility, while demo records are preverified; previous university study means returning status. Submitted answers lock except results completion; drafts, withdrawal and in-window resubmission preserve history. Mentor eligibility/programme changes pause new assignments and flag current matches for reassignment.

Seed the existing prototype project, preserving current users. Each programme receives 50 fictional Student-role accounts excluding existing users/additional mentors; undergraduate mix is 30 eligible first-years plus 20 returning students and 2 extra approved mentors. Include the full demo workflow scenario set and broad language-community coverage in every programme. Analytics will separately count Student-role accounts, active mentors, eligible mentees, unassigned eligible mentees and applications awaiting results.

The next implementation prerequisite is the read-only deployed schema/catalogue audit. This turn finalised planning documents; no new application code, migration execution, seeder run or account creation was performed.

### All 18 insertion answers confirmed — 19 October 2026

Recorded the user's insertion selections in `DEMO_DATA_PLAN.md`. Use a local Node.js Auth Admin API seeder, confirmed fictional email accounts for every generated user, ignored local administrative credentials, random bulk passwords and privately stored selected presentation credentials. Retain existing staff credentials without resets.

Audit the deployed catalogue/schema read-only, review qualification mappings and generate a CSV/count preview. The user chose **all programmes for the first insertion after preview and automated checks pass**, superseding the mandatory one-programme trial recommendation. Keep an optional trial command. Load in small batches with limited parallel requests, bounded transient retries and checkpoints; stop on schema/permission errors. Resume the same named batch without overwriting manual edits.

Use normal RPCs for current workflows and a restricted marked path for historical scenarios. Implement server-enforced demo-audience isolation before activity creation so seeded events, notices, messages and indirect notifications reach only demo accounts. Preserve existing users/data. Maintain private tracked manifests, selected login sheets, full verification and preview-first cleanup of tracked records only. Document audit, preview, optional trial, full seed, verify and cleanup commands.

This update records the agreed plan only. No seeder scripts, application behaviour, live records or accounts were changed. The deployed audit remains the first implementation prerequisite; all 38 form choices are confirmed and need no reconfirmation.

### Demo implementation started — read-only audit and preview tooling

The user requested implementation, then explicitly selected the **SQL audit export** route. Do not request an administrative key for this audit. Added `database/DEMO_READ_ONLY_AUDIT.sql`: one read-only SELECT exporting the deployed catalogue, columns, constraints/indexes, RLS, policies/grants, functions, Auth provisioning triggers, storage settings, existing student-number collisions and aggregate Auth/profile counts. Real-user names/passwords/tokens/keys are not selected. Fictional `@example.test` addresses are included for collision checks. Treat the export as private because it contains schema definitions and student numbers.

Added local Node commands `demo:audit`, `demo:preview`, `demo:check` under `scripts/demo/`, with instructions in `scripts/demo/README.md`. No new package dependency. Import accepts Supabase JSON/CSV export formats and produces `.demo-seed/audit-findings.json` plus a programme qualification review template. Reviewed qualification levels/max years are required before generating a preview. Named-batch preview includes 50 students per programme, UG 30/20 plus two intended mentor extras, deterministic fictional identities, language coverage including SASL, student-number collision avoidance, count CSVs, snapshots and integrity checks. Existing previews remain stable on rerun; changed schema/catalogue/mappings block continuation. Files are ignored and outside public assets. `.env.example` is for future live commands, not required for the chosen SQL audit.

The workspace still lacks Git metadata; existing frontend code and migrations were preserved. No live connection or account/data writes occurred. New tests execute the SQL inside a PostgreSQL read-only transaction, validate import/preview/domain boundaries and exercise CLI import→review→preview→check in a temporary workspace.

Next external prerequisite: run `database/DEMO_READ_ONLY_AUDIT.sql` in Supabase SQL Editor and save its exported JSON/CSV under `.demo-seed/`. Then import/review actual schema and programme qualifications before implementing lifecycle/eligibility migrations, frontend changes, demo-audience isolation and the live Auth seeder/scenarios. **The full plan is not complete:** live seed/trial/verify/cleanup commands and academic behavior changes remain pending the actual report. No policy choices need reconfirmation.

Validation: `C:\Program Files\nodejs\node.exe --test` passed all **43 tests**, including the existing dashboard/event suite and 11 new preparation tests. CLI help also runs successfully. Created the ignored `.demo-seed/` directory with a local README so the user can save the export directly there. No private deployment export has been received yet.

### Deployed SQL audit received and imported — 19 October 2026

The user pasted the downloaded SQL audit CSV into the former README using Notepad. The resulting file is `.demo-seed/audit-export.csv.txt` (428,791 bytes). Validated and imported it successfully with the local CLI: **4 faculties and 32 programmes**. Saved a correctly named `.demo-seed/audit-export.csv` copy without overwriting or removing the original. The extra `.txt` suffix did not affect parsing. No repeat SQL query or download is needed.

Private `audit.json`, `audit-findings.json` and `qualification-review.json` now exist. The deployed-export prerequisite is satisfied; next review those actual schema/function/policy definitions and classify the 32 programmes before generating the population preview and implementing the lifecycle/eligibility/audience migrations. No accounts or live records were changed by importing the report.

### Full implementation in progress — 19 October 2026

The user authorised finishing implementation. The deployed schema has now been reviewed and the user confirmed two catalogue refinements: Advanced Diplomas receive 50 returning students plus two extra mentors; the existing `medicine` programme is a six-year prototype qualification. Keep the catalogue otherwise unchanged, with no invented postgraduate programmes. Reviewed durations against UMP's 2026 Almanac pp18–20.

Implemented five new migrations, bundled atomically in `database/DEMO_INSTALL.sql`: academic lifecycle and verified eligibility; demo cohort isolation/registry/restricted seeding; appointment-based clients/analytics and messaging fixes; exact audited programme classification; normal-workflow idempotency, historical scenarios and the academic cron job. Existing users/history are preserved, legacy assignment years require supervisor review, and reinstallation cannot reactivate a supervisor-ended appointment. Schema contract hashing blocks seed writes after unexpected DDL/policy/grant changes.

Updated frontend mentor access, current/previous application cycle handling, academic declarations, supervisor evidence verification/extensions/history, mentor appointment controls, PG mappings, legacy assignment review, programme qualification editing and five distinct analytics measures with details/reports. Supervisor data and application loads are paginated. New `academic.js` is a required shared dependency, loaded before clients. Prior dashboard functions were retained.

Local Auth Admin seeder is implemented with bounded retries, 12-account batches/three workers, per-record private checkpoints, collision/ownership checks, preserved manual edits, selected private presentation credentials, normal RPC idempotency, restricted historical scenarios, verification and preview-first cleanup. Named batch `presentation-2026` preview: 1,600 Student-role accounts, 64 extra mentors, two marked demo staff = 1,666 accounts; 750 eligible first-time mentees. Private files remain under ignored `.demo-seed/`.

Most recent full test run: **58 passed**, including actual SQL on a sanitised deployed schema contract, atomic install/reinstall/drift checks and complete isolated seed/scenario/resume/cleanup. Public JS syntax checks passed. Further application-form UX checks are in progress. See `database/DEMO_DEPLOYMENT.md` and `scripts/demo/README.md` for commands.

**Deployment is still pending.** No live migrations or seed writes have occurred and no manifest/accounts exist. `.env.demo` was created only if absent, with the existing public project URL and an empty key; on the latest check the administrative credential was not configured. The user said they will configure it locally. Never print its contents/key. The SQL installer must also be applied through Supabase SQL Editor; a service-role Data API key cannot execute DDL. Do not call the live population complete until the install, full seeding and selected-login verification actually succeed. No further approval of the already confirmed policy or all-programme population scope is needed.

### Installer reported successful; final checks and live prerequisites

The user reported `DEMO_INSTALL.sql` completed successfully. A final compatibility
correction was saved afterwards: unknown-year legacy matches remain available
until supervisor review, while reviewed/new matches retain annual expiry. The
installer was rebuilt with seed-contract version 2. Asked the user to rerun the
current saved installer; confirmation is pending. Reinstallation preserves
application history and cannot resurrect ended mentor appointments.

Validation: **62 tests passed**, all **26 public JavaScript files** passed syntax
checks, and the private 1,666-account preview passed its checks. Added a further
assertion to the existing install test for preserving legacy matches, original
assignment dates and current-year access during supervisor review; that focused
test also passed. New secret API keys are sent only in `apikey`, with user JWTs
used for authenticated workflow Bearer headers.

On the latest local check, `.env.demo` still lacks its administrative key. Asked
the user to configure it locally without posting it in chat. Live installed
version/contract checks and the full seed run await that configuration and the
current installer. No live demo accounts or scenarios have been created. Continue
with a read-only `demo_seed_status` check once credentials are ready; require
version 2, intact schema and all workflow/isolation flags before the authorised
all-programme seed. Do not request policy/scope approval again. Final live
completion requires the verification report and selected-login checks to pass.

### Live population loaded; directory correction awaiting SQL Editor

The user configured the local key and reported rerunning the current installer.
The live version-2 schema contract, catalogue and isolation/workflow checks passed.
Created all **1,666 Auth/profile accounts**, including 1,600 Student-role accounts,
64 approved mentors and two marked demo staff. Actual batch report: 160 applications
(64 historical + 96 current), 600 matches, 50 messages, 16 calendar events, 32
attendance records, eight cancellation requests and two notices. Zero notification
leaks, cross-cohort matches, capacity violations or early first-year approvals.
Existing accounts were not adopted or reset.

The initial final verification found 19 failed presentation sign-ins; the first
rechecked account immediately succeeded. Serial verification now includes bounded
transient retries, progress output and private failure status/code. No passwords
were changed. Full final verification still needs to run successfully.

Live role checks confirmed all six analytics totals match their detail views.
The supervisor profile-directory request timed out at full volume. Implemented
`20261019050000_dashboard_read_performance.sql`: staff role checks are cached per
statement, CASE skips relationship lookups for staff, and mentor-assignment reads
have an index/cached role check. A 1,666-profile/500-assignment PostgreSQL regression
test passes while retaining student/mentor account visibility restrictions. The
atomic install/reinstall test also passes. Asked the user to apply ONLY this new
migration in SQL Editor; awaiting confirmation. The rebuilt installer includes
all six migrations, and seed preflight now requires `directory_reads`.

Corrected accented-name handling in fictional PDF labels while keeping Unicode
names in profiles. Exactly two just-generated tracked PDFs were replaced after
checking their bytes matched the original generator output; no edited document
was overwritten. Regression test passed. Private repair logs and read-only live
view checks are under `.demo-seed/`.

Next: after the new SQL migration is confirmed, check `demo_seed_status` flags,
run `demo:verify` (98 presentation sign-ins, serial), then the private
`.demo-seed/check-live-views.cjs` helper. It checks all analytics details, full
supervisor pagination, student/mentor access, faculty events, forbidden admin/seed
access and supervisor signed evidence URLs. Keep credentials and login sheet out
of tool/chat output. The account load is real; the whole deployment is not yet
verified complete.

### Population and all presentation sign-ins verified

The serial rerun succeeded: `.demo-seed/presentation-2026/verification.json`
reports `passed: true`, 1,666 profiles, 32 programmes, zero errors and zero login
failures. All 98 selected presentation accounts signed in successfully. Recorded
`population_verified_at` in the manifest; overall deployment completion remains
pending the performance patch and live role checks. The original failed-run
entry remains in the manifest error history; no credentials were reset.

The full regression suite now passes **63 tests**. Extended the new directory
test to include real calendar RLS at full volume: students/mentors see only
their own faculty, supervisors see both faculties. That focused test passed too.

Live read checks passed staff sign-ins, all six analytics total/detail mappings,
student sign-in/active match and mentor authority. The student calendar query also
hits the unoptimised profile-permission timeout. The tested performance migration
has not yet been applied on the latest check. Its policy correction addresses
both uses of profile RLS. Supervisor signed-evidence access, final calendar read
and full supervisor pagination remain to be checked after installation.

Private presentation sheet is ready at
`.demo-seed/presentation-2026/presentation-logins.csv`. Never print its passwords.
Next action is still the already-requested SQL Editor run of
`database/20261019050000_dashboard_read_performance.sql`, followed by
`.demo-seed/check-live-views.cjs` and `demo_seed_status`. Population verification
need not repeat all 98 sign-ins unless a new change or failure justifies it.

### Live access correction installed and verified

On continuation, checked the current notes and live contract without overwriting
existing changes. No Git metadata or additional Antigravity task notes were found
in the workspace. Population verification remained passed; the performance SQL
was still missing. The user then applied
`20261019050000_dashboard_read_performance.sql`. Live contract, directory and
calendar checks now pass.

Promoted the ignored one-off access helper into `scripts/demo/access.cjs` and
documented `npm run demo:access -- --batch presentation-2026`. It uses real
admin/supervisor/student/mentor JWTs and saves a private
`access-verification.json` without credentials or signed document URLs. It checks
all ten analytics detail/total cohorts, complete capped-page staff directories,
student matches, mentor authority, faculty/non-cancelled calendars, supervisor
evidence access and explicit privilege denials. A network failure or statement
timeout no longer counts as a successful permission denial. Missing SQL blocks
the affected expensive reads while independent checks continue.

Seed/full verification now require successful role-access verification before
recording completion. Added four meaningful regressions: capped pagination and
credential exclusion; missing-migration isolation; faculty/cancellation/evidence
failures; and false permission denials. Full suite: **67 tests passed**.

Actual live access check passed: both staff directories see 1,702 profiles;
student and mentor each see three own-faculty non-cancelled demo events;
all analytics totals match details; signed mentor evidence is available to the
supervisor; privileged RPCs explicitly reject students. The expired demo notice
is inactive. No accounts were recreated or passwords reset on continuation.

Combined `demo:verify -- --batch presentation-2026` finished successfully after
installation. It verified 1,666 profiles, all 98 presentation sign-ins and every
live access check, and recorded completion through the normal manifest path.
Both `verification.json` and `access-verification.json` passed. The deployment
blocker is resolved; no further SQL installation is pending for this demo setup.
Selected credentials remain in the private `presentation-logins.csv` sheet.
For later read-only diagnostics use `demo:access`; for full population/login and
access verification use `demo:verify`. Existing unknown-year matches remain a
supervisor review task rather than having their academic years guessed.

### Dashboard interaction and collection layout updates — 19 October 2026

Implemented the user's follow-up interface requests without changing database
schema or existing records:

- Mentor "Log first contact" now opens the in-app Messages view with the correct
  assigned student and a personalised editable introduction. It does not record
  contact on opening. Successful Send records contact through the existing RPC;
  failed sends retain drafts. Drafts stay with each recipient, in-flight thread
  loads cannot replace another student's conversation, and compose/send controls
  prevent switching recipients during a send.
- Supervisor application and shortlist tables start hidden behind separate
  Show/Hide buttons with counts and accessible expanded state. Their open/closed
  state survives list refreshes. Existing review actions remain under three dots.
- Added `dashboard-counts.js` on all four dashboards. Sidebar badges show actual
  relevant collections: students/mentors/matches, applications, event actions,
  conversations, upcoming faculty events, admin accounts/programmes and active
  notices. Collection labels explain the count; notification unread badges retain
  their own semantics. Exact server counts and existing complete data-loader
  events avoid API page-limit truncation. Counts refresh on actions/focus and
  periodically.
- Event requests load all API pages and sort by Johannesburg event date/time.
  Nearest upcoming requests come first. Mentors' older/declined/cancelled entries
  are muted inside a closed history disclosure, preserving outcomes and review
  history. Completed cancellation records correctly classify cancelled events
  even when calendar RLS hides the event row. Reused the existing mentor request
  panel to remove a duplicate ID/loading panel.
- Shared responsive CSS contains long text, names, programme information,
  messages and form controls. Tables scroll inside bounded, keyboard-focusable
  wrappers, with readable application columns/student numbers. Mobile navigation
  tabs retain their width and scroll instead of overlapping; badge/toolbar/action
  layouts remain contained. Updated Help instructions.

Validation: **72 tests passed**, including five added interaction regressions for
intro/draft/contact timing, failed sends, event ordering/history and badges on all
roles. All public JS syntax, dashboard IDs and local script references passed.
Real Edge browser checks against the deployed demo data passed at 1280px desktop
and 390px mobile widths for mentor introductions and collapsed/expanded supervisor
application lists. Reviewed screenshots and corrected mobile tab overlap and
overly narrow table columns; no horizontal page overflow remained. Browser
review did not send any live messages. Private screenshots/helper/report are in
ignored `.demo-seed/`. Existing user changes and demo population were preserved.

These updates require reloading the local app, with a hard refresh if cached.
No additional SQL migration or seed run is required for this follow-up.

### Shared visual consistency pass - 19 October 2026

Completed the requested presentation-only review across all seven public HTML
pages, including the four role dashboards, entry/sign-in/registration, Help and
QR attendance. Preserved the existing application scripts, permissions,
notification count semantics, workflows and database records.

- Added `public/ui-theme.css`, loaded after the existing base stylesheet on each
  page. Shared colour, type, surface, border, spacing and control styles keep
  existing and dynamically generated components visually consistent.
- Removed the obsolete supervisor notification ID override from `student.css`.
  Notification and collection badges now share the same capsule shape, colour,
  size, padding and typography. Unread values, hidden zero counts and the 99+
  display remain controlled by the existing scripts.
- Standardised cards, headings, buttons, inputs, selects, text areas, tables,
  status labels, disclosure rows, feedback and keyboard focus indicators.
  Destructive actions remain visually distinct.
- Improved native dialogs, including dynamically opened evidence and account
  editors, with bounded viewport dimensions, scrolling and consistent spacing.
  Corrected oversized evidence checkboxes and aligned them with their labels.
- Matched public entry, Help and attendance branding to the dashboards. Improved
  registration label alignment, mobile mentor portraits and past calendar item
  readability. Mobile notification titles now use the available card width, with
  read/unread controls on a separate row. Reduced-motion styling is included.

Validation: the existing regression suite passed all **72 tests**. CSS parsing,
unique page IDs and local asset checks passed for all seven pages. Real headless
Edge review against the deployed demo data passed **64 desktop/mobile screen
states**, plus **six fully loaded notification states** across student, mentor
and supervisor accounts. Computed notification and collection badge styles match.
Tested at 1280px and 390px widths with no page-level horizontal overflow in the
reviewed states. Inspected screenshots, including mobile notifications and
evidence dialogs. No messages were sent or read states changed by the review.
Private browser helpers, screenshots and reports remain in ignored `.demo-seed/`.

Reload the app with Ctrl+F5 to load the shared stylesheet. No SQL migration,
account creation or seed rerun is required for these visual changes.

### Directory, identity and catalogue follow-up - 19 October 2026

Inspected current scripts, task notes and the live profile catalogue before
editing. Saved the relevant pre-change files privately under
`.demo-seed/directory-before-20261019/`; existing user data and prior work remain
intact. This follow-up changes directory interactions and presentation, with no
database migration or account updates.

- Added shared `directory.js` matching for admin and supervisor: case/accent
  insensitive searches, name parts in any order, email and student-number search,
  combined filters, and account identity based on profile ID rather than names.
- Fixed supervisor programme/mentor dropdowns that previously lacked change
  handlers. Added faculty-dependent programme choices and filters for assignment,
  entry status and study year. Secondary controls live under More filters.
  Faculty changes clear stale programme/mentor choices; selecting an unassigned
  status clears the mentor selection. Search, pagination and result totals now
  use the same matched collection. Removed unused debounce code/state.
- Admin User accounts now includes student numbers, status filtering, Clear
  filters and 25/50/100-row pagination. Programme account dropdowns display the
  student number or email below each name; account detail dialogs include the
  student number. Profile loaders deduplicate repeated rows by account ID while
  retaining separate accounts that share a name.
- Read-only live audit of all 1,702 profiles found zero duplicate profile IDs,
  student numbers or emails and zero faculty/programme mismatches. The fictional
  name pool produced 175 repeated-name groups across programmes: these are
  distinct accounts with distinct numbers, rather than one student enrolled in
  several programmes. No identities were renamed, merged or deleted.
- Existing faculties/programmes now start inside closed disclosures. Programmes
  are grouped into closed faculty disclosures with a programme/faculty search;
  matching groups open on search. Long groups scroll locally and support keyboard
  focus. Rename, delete and qualification actions remain under three-dot menus.
- Removed sidebar totals for admin User accounts and Faculty & programmes, and
  supervisor Students, Mentors and Mentor assignments. Explicit opt-out metadata
  prevents those badges being recreated. Actual unread notification badges and
  action-review counts retain their existing behaviour; overview/analytics totals
  remain available.
- Directory tables keep readable column widths with scrolling inside the panel;
  filters and actions wrap on mobile. Corrected a malformed supervisor Help link
  and documented the new directory/catalogue controls in Help.

Validation: **75 tests passed**, including new regressions for combined immediate
filtering, faculty resets, mentor/unassigned compatibility, namesake identity,
admin pagination/status search, collapsed programme search and edit controls.
Public JavaScript syntax, all seven HTML pages' local assets/unique IDs and all
three CSS parsers passed. A headless Edge control audit checked **512 visible
control instances across 25 dashboard views**: no missing click/native/delegated
handlers or invalid dashboard navigation targets in those loaded views. This
audit checks wiring; it does not execute every destructive or submit action.
Live read-only browser checks passed **32 desktop/mobile states** at 1280px and
390px, including faculty/programme and unique-number searches, account details,
pagination, collapsed/open catalogue groups and three-dot programme actions.
Reviewed screenshots and corrected cramped directory columns. Private reports
are `control-audit.json` and `directory-ui-verification.json` under the ignored
presentation batch. No live account edits, messages or destructive actions were
performed during review. Hard-refresh the local app; no SQL or seed run needed.


## Project-wide applications, updates and sign-in - 20 October 2026

Implemented the requested behavior throughout the project:

- Mentor review filters search both applications and shortlisted candidates, combine status/school/programme/study-year/target-year choices, retain filters on refresh, and show matching counts. Request sequencing prevents older responses from overwriting newer results.
- Event request and Updates labels are consistent across dashboards, notifications, help and deployment notes. The real Higher Certificate in Event Management qualification remains unchanged.
- Update publication offers University update or Application updates. Banners and student/mentor/supervisor notifications retain the selected title. Demo scenarios use both supported choices.
- Shared public/auth.js verifies the current profile and active mentor appointment across all dashboards, resumes existing sessions, redirects wrong-dashboard links, gates data loading and handles sign-out across roles/tabs. QR attendance links continue after sign-in. Sidebar counts use the resolved dashboard role.
- Added database/20261020000000_update_titles.sql for existing deployments and included it in both SQL bundles. It preserves existing update content and notification read state while correcting generic supervisor headings.

Validation: the full automated suite passed 104 tests. Two additional regression cases for effective-role sidebar counts and attendance return links passed in the 15-test auth suite (106 unique tests total). All public JavaScript and server.js passed syntax checks; HTML IDs/local assets and HTTP routes for all dashboards, attendance and changed shared assets passed. No live Supabase migration or deployment was performed; browser layout and live signed-in workflows remain unverified. Apply the individual update_titles migration to the existing deployment before releasing its notification changes.


## Natural account presentation - 20 October 2026

Completed the authorised live conversion of the existing presentation-2026 batch:

- Updated 1,666 existing Auth/profile identities. All 1,664 student and mentor addresses now equal their existing nine-digit student number followed by @ump.ac.za. The two staff accounts use personal-name UMP addresses. Names remain fictional; the same account IDs, passwords, academic fields, statuses and protected ownership metadata were retained.
- Replaced visible generated-data labels in 17,685 activity/history records and 170 supporting PDFs. Profile school labels now use faculty names / Student Affairs. Removed the remaining visible label from the help page and updated email placeholders. Internal batch keys and storage paths remain private for isolation and cleanup.
- Added resumable accounts:refresh tooling with collision checks, private backups/previews, Auth/profile synchronization and persistent appearance overlays. The original reviewed plan and hash remain immutable. Seeding, resume, verification, cleanup and credential exports use the updated appearance. Windows transient checkpoint locks and temporary PDF rate limits have bounded retries.
- Updated future identity/scenario generation and prepared 20261020010000_natural_account_labels.sql, included in the eight-migration installer. That SQL upgrade was not applied live in this task and is only needed before provisioning future batches with the new generator; conversion of these existing accounts used the authorised Admin/scoped record APIs.
- Updated private presentation-logins.csv (98 selected credentials) and current-accounts.csv (all 1,666 displayed accounts). Backups, passwords, reports and internal markers remain outside public/ and ignored by source control.

Validation: full automated suite passed 130 tests; the additional bounded PDF-download retry regression passed in its seven-test suite (131 unique tests). All application/account scripts passed syntax checks. Final live appearance verification passed with zero discrepancies across 1,666 managed identities, 18,070 visible records/history rows and all 170 PDFs. Five selected password sign-ins and all real-role access checks passed. The 64 active mentors and 608 assignments match the original baseline. No pre-change unowned-account value snapshot was available; all mutations were structurally restricted to the protected manifest IDs/batch. Localhost returns the updated sign-in page with HTTP 200.
