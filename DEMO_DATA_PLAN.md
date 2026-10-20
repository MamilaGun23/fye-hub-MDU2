# FYE Hub prototype population plan

Planning status: 19 October 2026. The user has answered all 20 policy/population questions and all 18 insertion questions; those choices are authoritative below. This document specifies future implementation. No accounts or database records have been created as part of this plan.

## Implementation progress — 19 October 2026

The user authorised implementation and selected **SQL audit export**, rather than
configuring an administrative key for the audit. Do not request a key for this
read-only stage. Prepared `database/DEMO_READ_ONLY_AUDIT.sql` and local commands
`demo:audit`, `demo:preview` and `demo:check`; see `scripts/demo/README.md`.
The audit query is tested inside a PostgreSQL read-only transaction. Import
supports Supabase JSON/CSV exports and reports provisioning triggers, schema
constraints, policies, function bodies and catalogue data. Private generated
files live under the ignored `.demo-seed/`, outside the served public directory.

Preview generation requires reviewed qualification levels and valid study years.
It produces deterministic named-batch identities, count CSVs, immutable snapshots
and integrity checks. It enforces 50 Student-role accounts per programme, the
30/20 undergraduate mix plus two extra intended mentors, valid qualification
years, collision-free nine-digit student numbers and 12 language preferences per
programme. Additional postgraduate mentor scenarios still require explicit
programme mappings and separately tracked accounts in the later scenario stage.

**Pending prerequisite:** the actual deployed SQL export has not been provided.
No catalogue or academic classifications have been invented. Live insertion,
trial, verification and cleanup commands are not yet implemented/enabled, and
academic database/UI rules remain unchanged. The SQL report is needed to design
the lifecycle/eligibility migrations and demo-audience enforcement against the
actual schema, then implement and test the live seeder and scenarios. Offline
policy helpers used by preview are not database enforcement.

## Confirmed matching policy

The user confirmed: **mentor matching supports only first-time undergraduate students**.

A new mentee assignment must require all of the following:

- Active account with the Student role.
- An undergraduate qualification.
- Year 1 of that qualification.
- Supervisor-verified first-time university entrant status, recorded separately from qualification and year of study. Trusted demo records are preverified.
- No existing active mentor assignment.
- An eligible mentor with an active appointment in the same faculty and programme, or an approved postgraduate mentor explicitly mapped by a supervisor to that undergraduate programme. The maximum is 20 active mentees per mentor in total across all mapped programmes.

Returning undergraduates, including returning students repeating Year 1, do not enter the mentee pool. Honours, postgraduate diploma, master's and doctoral students do not enter it, even when they are in Year 1 of their qualification. They can still have accounts and appear in appropriate directories, events and analytics.

Mentee eligibility and mentor eligibility are separate rules. First-year students may apply during the recruitment window described below, but cannot be approved until the following calendar year and verification of their final first-year results. Returning students at any qualification level may apply during the same window. The current `study_year >= 2` application checks must be replaced, including the database constraint, RPCs, trigger, forms and help text. Do not misrepresent a student's study year to make them pass those checks.

Ordinary matching remains within the same faculty and programme. The user explicitly authorised an exception for approved postgraduate mentors: supervisors map each mentor to suitable undergraduate programmes within the mentor's faculty. Postgraduate students do not become mentees. Mentor approval alone does not create a programme mapping, and no automatic cross-faculty or arbitrary cross-programme allocation is allowed.

## Academic information required

Store qualification level against the actual programme catalogue. Store year within the qualification and first-time/returning entry status against the student's registration. Proposed levels include undergraduate, honours, postgraduate diploma, master's and doctorate, restricted to the qualifications actually offered by each programme.

Do not infer first-time status from `study_year = 1`. Students declare academic details; a supervisor verifies them before assignment or mentor approval. Missing or unverified information excludes an account from new assignments until verified. Anyone with previous university study, including transfer/readmitted students, is returning and cannot receive a mentee match. Trusted synthetic demo records are preverified. Audit legacy assignments and preserve their history when applying the confirmed annual rollover rules below.

## Confirmed annual mentor application cycle

All new mentor applications open on **1 October** and close at the **end of 31 January** in the following calendar year, using **Africa/Johannesburg** time. Implement the closing boundary as 1 February at 00:00, exclusive. February through September is closed for new applications, including new submissions following a decline. Reviewing applications already received is not restricted to this submission window.

For a cycle starting in year Y:

| Applicant | Submission rule | First-year approval rule |
| --- | --- | --- |
| First-time undergraduate entrant from year Y | May apply from 1 October Y through 31 January Y+1 | Cannot be approved before 1 January Y+1; verified final results must establish eligibility to progress to Year 2, and registration for the new academic year must be verified. Supervisor approval remains required. |
| New first-time entrant arriving in January Y+1 | Must wait until October Y+1; cannot join the preceding October's recruitment cycle | Same deferred approval rule for their own first-year cohort. |
| Returning undergraduate, honours or other postgraduate student | May apply during the October–January window, using their actual qualification/year | Provide latest available academic results and proof of current registration. All new appointments start in the following academic year, not immediately upon an October–December approval. |

The January cohort interpretation above was explicitly confirmed by the user. January belongs to the recruitment cycle that opened the preceding October. A student who was a first-year entrant in Y keeps that first-year application classification for this cycle even after their profile advances to Year 2 in Y+1.

The user also explicitly confirmed that first-year applicants may submit before final results exist, then upload them later, **including after 31 January if publication is delayed**. That is completion of an on-time application, not a late new application. Keep initial submission eligibility separate from the ability to attach or verify outstanding results. Final results do not trigger automatic approval.

Example: a student entering university in 2026 can submit from **1 October 2026 to 31 January 2027**. Their first-year application cannot be approved during 2026, even if results appear in December. In 2027, approval requires verified final 2026 results. A new January 2027 entrant waits until **1 October 2027** to apply.

Applying does not grant mentor access or remove the applicant's existing mentee assignment. All new appointments are for academic year Y+1. An October–December approval is scheduled for that year; a January or later approval may activate in that year once requirements are satisfied. Activation cannot precede either approval or the target academic year. End any remaining mentee assignment when the mentor appointment actually starts, preserving its history.

Outstanding supplementary examinations keep the application pending until results establish eligibility. There is no conditional activation or student assignment while this requirement is outstanding.

Results completion normally closes at the end of **31 March Y+1** (exclusive boundary: 1 April 00:00 Johannesburg time). Supervisors may record application-specific extensions for delayed results, including a new deadline, reason, supervisor and timestamp. These extend completion of an existing on-time application, never the new-application submission window.

Keep academic-record versions. A replacement before approval resets verification. A replacement after approval requires supervisor review; do not silently replace the evidence supporting the original decision.

## Mentor appointments and annual mentee rollover

- An activated mentor appointment continues **until a supervisor ends it**. No annual reapplication or automatic December expiry applies to the mentor appointment. Application history and active mentoring authority must be separate.
- A mentor changing programme, becoming inactive or losing eligibility is paused for **new assignments**; existing matches are flagged for supervisor reassignment. Do not automatically end those matches solely because of that change. Inactive accounts remain subject to existing access restrictions.
- Mentee assignments automatically end at the **end of December 31** of their assignment academic year. Represent that as the next January 1 at 00:00 Johannesburg time and retain ended records. This assignment rollover does not end a continuing mentor appointment.
- Store the assignment academic year/effective end explicitly. Assignment eligibility, capacity, messages and reports must recognise the effective end even if a background job has not yet written `ended_at`. A scheduled reconciliation job can persist end timestamps and an audit reason.
- Existing data needs a reviewed academic-year backfill before enabling automated rollover; do not guess years or delete assignment history.
- Continuing mentors do not submit annual renewal applications. Registration/eligibility changes can pause assignments under the chosen rule, without inventing an annual reapplication requirement.

## Application lifecycle and history

Drafts are allowed. On submission, lock application answers except the supported academic-results completion/replacement workflow. Preserve the first submission timestamp and a snapshot of the entry cohort. Students can withdraw. A declined applicant may resubmit during the same open October–January window with earlier attempts and decisions retained; no resubmission after the window closes.

Use one logical application per applicant per recruitment cycle with revision/attempt history, rather than overwriting old decisions or creating ambiguous duplicates. Separate draft, submission, withdrawal, results readiness/verification, closure for missing results, review decision and mentor appointment state. Adapt existing status queries, notifications, uniqueness constraints, login checks and storage policies consistently. Historical approval must not independently grant access after the associated appointment is ended or paused; an approved future appointment must not grant early access.

### Application data and enforcement changes required

- Record the recruitment cycle and a server-controlled snapshot of entry cohort/first-year status at submission; retain it when the profile's current study year changes.
- Keep results readiness/verification separate from the existing pending/shortlisted/approved/declined review status, so deferred candidates remain visible in the supervisor workflow.
- Store the results academic year and verification audit (who verified, when), without inventing an institution-wide results publication date.
- Allow first-year submission without a final academic-record PDF. Require the correct verified final record before first-year approval, and support later attachment outside the submission window.
- Enforce dates, cohort eligibility, result requirements and deferred approval in the database as well as the interface. The server's Johannesburg date is authoritative.
- The existing table permits only one application per applicant, and several clients use `maybeSingle()`. Introduce recruitment-cycle history with a consistent current-cycle lookup; do not simply add duplicate rows or overwrite previous decisions. Update uniqueness rules and all related clients/RPCs together.

## Confirmed student-number convention

Use the user's supplied nine-digit example convention for generated students: **YY + seven digits**, stored as a string. The first two digits are the year the student originally began first year at the university. For example, `230199798` indicates a 2023 entry year; it is a supplied example, not a seed identity to copy.

Store the full first-entry year explicitly. Generate a unique seven-digit suffix and check collisions against existing and proposed student numbers. Preserve leading zeros. A returning student keeps their original entry-year prefix when progressing or starting an honours/postgraduate qualification; do not replace it with the current qualification's start year. Study year and mentee eligibility must not be inferred from the student-number prefix alone, since interruptions and repeated years are possible.

## Confirmed naming and language coverage

Generated identities must use culturally appropriate South African names with coverage across the official language communities: isiZulu, isiXhosa, isiNdebele, siSwati, Sepedi, Sesotho, Setswana, Tshivenda, Xitsonga, Afrikaans and English. Include South African Sign Language users in language-preference coverage, using ordinary written names from varied cultural backgrounds rather than inventing an exclusive SASL name pool.

Use curated given-name/surname pools, preserve spelling and Unicode characters, and distribute identities across faculties/programmes rather than assigning a language community to a single faculty. Names must not be treated as proof of a person's language, ethnicity or disability. Any language-preference value is a separate synthetic attribute. Use fictional emails and unique student numbers; do not copy real student lists or the user's supplied identity into the seed dataset.

Official-language reference: https://www.gov.za/sites/default/files/gcis_document/202307/49041-27-7-consteighteenthamendac32023.pdf

## Confirmed demo population

For each undergraduate programme:

| Account group | Confirmed count |
| --- | --- |
| First-time undergraduate Year 1 students | 30 |
| Returning undergraduate students in valid study years | 20 |
| Additional approved returning undergraduate mentors | 2 |

This provides 50 Student-role accounts plus two Mentor-role accounts, with enough capacity for the 30 eligible mentees. Leave a subset unassigned to demonstrate manual and balanced allocation. Returning students who apply for mentorship remain students until approved; promotion must not reduce the 50-student target.

For each honours/postgraduate programme, create at least 50 fictional Student-role accounts across valid study years and entry histories. They populate the application without becoming FYE mentees. Include postgraduate mentor/application examples in the presentation scenarios, and require explicit same-faculty undergraduate programme mappings before those approved mentors can receive assignments. Additional mentor accounts are separate from the 50 students.

The target is the **existing prototype Supabase project**, preserving its current users. Create 50 fictional Student-role accounts per programme; existing users do not count toward this target. Undergraduate programmes additionally receive the two approved mentors shown above. Confirm the deployed catalogue/qualification mapping to calculate the total account count, rather than asking for population preferences again. Faculties with no programmes are reported, not populated through invented programmes.

Provide broad official-language-community coverage **within every programme**, using varied fictional names and separate language preferences, including SASL users. Populate the full presentation scenario set: mentor applications, assignments, faculty events, attendance, cancellation requests, notices and sample messages. Preserve the 50-Student-role minimum when adding approved mentors.

## Confirmed analytics measures

Expose separate counts, matching details and reports for Student-role accounts, active mentors, eligible mentees, unassigned eligible mentees and applications awaiting results. Student-role account totals include registered returning/postgraduate students who are not eligible for FYE matching. Active mentor totals must reflect effective appointment dates, supervisor ending/pausing and active account status; approval of a future appointment is not current activation. Eligible and unassigned counts use verified cohort information and effective assignment expiry, not just raw roles or null `ended_at` values.

## Implementation sequence

1. Inventory the deployed faculties/programmes, profile schema, constraints and Auth-to-profile provisioning trigger. The original foundational schema is missing from this repository, so local migrations alone cannot establish the deployed structure.
2. Define programme qualification levels, first-entry year, declared versus verified student details, recruitment-cycle history, document verification, mentor appointments and postgraduate programme mappings. Replace the old mentor Year-2 restriction with cycle-aware eligibility, deferred first-year approval and results completion/extensions.
3. Enforce mentee eligibility, mentor activation/mappings, total capacity and effective annual assignment expiry in supervisor selection, manual/balanced RPCs and database assignment triggers. Update login, calendars, messages, notifications, analytics and reports to use the same authority/active-assignment rules. Keep ordinary student directories broader than the assignment pool.
4. Build a local seeder using Supabase's Auth Admin API and a server-only administrative credential. Generate synthetic identities and confirmed login accounts; never add the credential to browser code.
5. Produce a dry-run inventory showing planned additions by faculty, programme, qualification and cohort in the existing prototype project. Preserve existing users and identify every generated record through a protected seed registry/batch identifier.
6. Validate the CSV preview and automated checks before account creation. The first actual insertion run covers all mapped programmes, as selected by the user; a one-programme trial remains an optional command, not a required gate.
7. Seed all mapped programmes in small resumable batches with limited parallel requests and progress checkpoints, without duplicate accounts. Address remaining unpaginated supervisor queries before relying on directories with more than one API page of users.
8. Add controlled presentation scenarios: pending/shortlisted/declined mentor applications, valid assignments, faculty events, attendance, cancellation requests, notices and selected messages. Use clearly synthetic documents where required.
9. Generate a private presentation login sheet and a population verification report. Cleanup must target only the specific demo batch and its dependent records.

## Acceptance checks

- At least 50 synthetic Student-role accounts in every mapped programme, excluding extra mentors.
- Faculty/programme references and qualification years are valid.
- Returning Year 1, postgraduate Year 1, inactive, unclassified and already-assigned students are excluded from new mentee assignments.
- Valid first-time undergraduate students can be assigned manually and through balancing; capacity remains at most 20 per mentor.
- Direct RPC/database assignment attempts cannot bypass eligibility.
- Mentor applications open on 1 October and close at 1 February 00:00 Johannesburg time; outside-window submissions are blocked at the database layer.
- New January entrants cannot join the preceding October's cycle. The previous year's first-year cohort can submit through 31 January.
- First-year applications are accepted without final results; approval is blocked in their entry year and until final results have been verified in the following year.
- An on-time applicant can add outstanding final results after the deadline without creating a late application; supervisor approval remains manual.
- Annual application history and cohort snapshots remain correct after student study-year rollover.
- First-year approval requires verified Year-2 progression eligibility and new-year registration; supplementary results keep an applicant pending.
- Returning applicants supply latest academic results and current registration. No new appointment activates before the following academic year or before approval.
- Results completion closes March 31 unless a supervisor records an extension. Replacing verified results resets pre-approval verification or requires post-approval supervisor review.
- Active mentor appointments continue until a supervisor ends them; annual assignment rollover does not end mentor appointments.
- Mentee assignments expire at the end of December 31 with history retained; effective expiry is enforced even if reconciliation jobs are delayed.
- Postgraduate mentors receive students only through supervisor-approved undergraduate programme mappings within their faculty. Capacity is 20 in total, not per mapping.
- Profile/eligibility changes pause new assignments and flag existing matches for reassignment. An activating mentor's former mentee assignment is ended with history retained.
- Drafts, locked submitted answers, withdrawal and in-window resubmission preserve submission and decision history.
- Generated student numbers have nine digits, unique suffixes and the correct original entry-year prefix.
- Names and synthetic language preferences cover the official language communities, including SASL users, without inferring personal attributes from names.
- Existing users are preserved. Legacy assignments are reviewed/backfilled, then ended under the agreed annual lifecycle without deleting history.
- Re-running the seeder resumes safely, reports match database totals, and cleanup is restricted to marked demo records.

## Confirmed answers to the 20-question form — 19 October 2026

These choices supersede the earlier gap-review recommendations, particularly the earlier suggestion of annual mentor renewal and the former prohibition on postgraduate programme mappings.

| Question | User's selected policy |
| --- | --- |
| 1. Mentor term | Until a supervisor ends it; no annual reapplication. |
| 2. First-year academic requirement | Verified eligibility to progress to Year 2 and registration for the new academic year. |
| 3. Returning applicant evidence | Latest available academic results and current registration proof. |
| 4. Supplementary exams | Keep pending until results establish eligibility. |
| 5. Missing-results closure | End of March, with recorded supervisor extensions for delayed results. |
| 6. Replacement results | Reset verification before approval; require supervisor review after approval. |
| 7. Postgraduate mentor allocation | Supervisor maps each mentor to suitable undergraduate programmes within the same faculty. |
| 8. Academic/cohort verification | Students declare; supervisors verify before assignment/approval; seeded demo records are preverified. |
| 9. Transfers/readmissions | Anyone with previous university study is returning and is not an eligible mentee. |
| 10. Annual mentee assignment end | Automatically end December 31, retaining history. |
| 11. Appointment start | Following academic year; January approvals may start in that year. |
| 12. Mentee becoming mentor | End the mentee assignment when mentor appointment starts; retain history. |
| 13. Application edits | Drafts; lock submitted answers except results uploads; withdrawal; in-window resubmission after decline with decision history. |
| 14. Mentor eligibility/programme changes | Pause new assignments and flag existing matches for supervisor reassignment. |
| 15. Seed environment | Existing prototype Supabase project, preserving current users and marking generated records. |
| 16. Population target | 50 fictional Student-role accounts per programme, excluding existing users and additional mentors. |
| 17. Undergraduate mix | 30 first-time first-year students, 20 returning students and 2 additional approved mentors per programme. |
| 18. Scenario coverage | Applications, assignments, faculty events, attendance, cancellation requests, notices and messages. |
| 19. Language representation | Broad coverage within every programme, varied fictional names, separate preferences including SASL. |
| 20. Analytics | Separate Student-role, active mentor, eligible mentee, unassigned eligible mentee and awaiting-results counts. |

## Implementation details remaining after policy confirmation

The 20 choices above are confirmed. The remaining work is to inspect the deployed schema/catalogue and translate those rules into coherent migrations, interface changes, tests and a resumable seeder. No additional confirmation of those policy or environment choices is needed.

### Implementation and presentation preparation

- **Exact data target and analytics:** implement the confirmed 50 generated Student-role accounts per programme plus additional mentors, without counting existing users. Implement the five agreed analytics measures and align detail views and exports with their definitions. Existing platform totals include mentor accounts and must be reconciled when labels/counts change.
- **Live schema and provisioning:** check the actual signup/profile trigger, existing storage policies, student-number uniqueness and profile permissions before bulk Auth creation. A created Auth account with a failed profile insert must be resumable without duplication. Track Auth IDs, profile IDs, application IDs and Storage paths in the seed manifest; record partial failures and use controlled batches/retries.
- **Demo environment and cleanup:** use the confirmed existing prototype project and preserve existing users. Cleanup must account for cancellation-request foreign keys and restrictive event-audit references, alongside Auth and Storage records; a generic delete of marked profile rows is insufficient. Keep seed manifests and presentation credentials outside public assets and source control.
- **Seed-trigger side effects:** use normal application RPCs for current workflows and a restricted, marked seed path for historical scenarios. Implement and test a controlled demo-audience boundary before creating activity: seeded events, notices, messages and trigger-generated notifications must reach only demo accounts. Include cancellation notifications and calendar visibility. Preserve normal faculty/role restrictions; do not leave a general live bypass for recruitment or approval rules.
- **Presentation dates:** as of 19 October 2026, the current recruitment window is open, but first-year entrants from 2026 cannot legitimately be approved yet. Seed previous-cycle applicants (for example, first-year 2025 applications approved in 2026) for existing approved mentors. Show current 2026 first-year applications awaiting results/deferred approval. Use isolated tests for future dates rather than changing the live application clock.
- **Broader volume checks:** paginate supervisor profiles, applications and assignments and test selection/filter/report counts with more than one API page. Ensure the full generated population, not just its first page, appears in directory and capacity calculations.
- **Language data quality:** review curated names for natural spelling, preserve Unicode and verify broad coverage in each programme, as confirmed. Language preference remains separate from names; real-person identity and language are not inferred.

### Additional acceptance cases

- Exact opening/closing boundaries and January cohort rollover in Johannesburg time.
- Results replacement resets verification and cannot silently approve a deferred applicant.
- Ended, paused or future mentor appointments and editable registration metadata do not bypass current eligibility rules. A continuing active appointment remains valid without annual reapplication.
- Duplicate submissions, simultaneous supervisor decisions and concurrent assignments preserve application uniqueness and capacity.
- A failed/restarted seed run reconciles both Auth and application records; cleanup removes only its own dependent data.
- Demo scenarios respect actual dates and preserve the minimum Student-role population after mentor promotions.

## Confirmed insertion choices — 19 October 2026

These 18 answers replace earlier insertion recommendations, including a mandatory trial-first approach. They do not change the confirmed academic policies above.

| Question | User's selected approach |
| --- | --- |
| 1. Insertion method | Local Node.js seeder using Supabase Auth Admin API, followed by profiles and demo activity. |
| 2. Sign-in coverage | Every generated user has an Auth account; prepare selected presentation logins. |
| 3. Administrative credential | Ignored local environment file; commit only an example template. Never expose credentials in browser code or chat. |
| 4. Email addresses | Unique deterministic fictional addresses, such as `demo.p004.s001@example.test`; confirmed accounts without email invitations. |
| 5. Passwords | Random bulk passwords; separate memorable password for selected presentation accounts, stored privately. |
| 6. Catalogue and schema | Read-only audit report; review programme qualification mappings before seeding. |
| 7. Preview | CSV plus counts by faculty, programme, qualification, cohort and language preference before creating accounts. |
| 8. First insertion run | All programmes after preview and automated checks pass. No mandatory trial run. |
| 9. Reruns | Resume the same named batch; create missing records and preserve manual demo edits. |
| 10. Failure handling | Bounded backoff for temporary failures; stop on schema/permission problems and save resumable progress. |
| 11. Loading | Small batches, limited parallel requests and progress checkpoints. |
| 12. Activity creation | Normal application RPCs for current workflows; restricted, marked seed path for historical scenarios. |
| 13. Existing data | Preserve existing users/data; keep generated assignments, messages and recipients within the marked demo cohort. |
| 14. Notification isolation | Controlled demo-audience boundary: seeded activity reaches only demo accounts. |
| 15. Presentation logins | Selected admin/supervisor test logins and representative student/mentor logins across faculties; retain existing credentials. |
| 16. Completion checks | Auth/profile links, 50 Student-role accounts per programme, academic fields, cohort eligibility, mappings/capacity, scenarios and selected logins. |
| 17. Removal | Private batch manifest and cleanup command that previews and removes only tracked records. |
| 18. Local commands | Document audit, preview, optional trial, full seed, verification and cleanup. |

### Seeder implementation safeguards

- Key deterministic identities by named batch and programme. Check against existing Auth accounts and student numbers; never adopt or overwrite an unmarked existing account because an identifier happens to match.
- Inspect automatic profile provisioning before inserting profiles. Preserve the Auth UUID/profile link and checkpoint partial success so retries reconcile a created account rather than creating another.
- Keep private manifests, generated passwords and presentation sheets outside public assets and source control. Preserve generated credentials on resume; do not reset manually edited demo accounts. Existing staff passwords cannot be retrieved from Auth: retain their credentials and reference them privately only when supplied locally, without resetting them.
- Save per-record creation progress, including dependent IDs and storage paths, for restart and dependency-aware cleanup. A cleanup preview must identify the named batch and refuse untracked records.
- Isolate demo activity in server-enforced audience checks, including notifications produced indirectly by triggers. Test that pre-existing users receive no seeded messages or notices and cannot see faculty demo events outside the intended audience.
- Stop before insertion if catalogue classification is incomplete, required migrations are absent, the schema differs from the audited schema, or preview/automated validation fails. Report the actual catalogue-derived total rather than inventing missing programmes.
- The optional trial command remains available for troubleshooting. The approved first-run scope is all programmes, loaded through the same limited-concurrency batching and checkpoints.

## Implementation and deployment progress

The read-only SQL audit has been imported and the existing 32 programmes have
been classified. The user confirmed that the seven Advanced Diplomas receive
50 returning students and two additional mentors each. The manually named
medicine programme remains a six-year prototype programme. No honours or
postgraduate programmes have been added to the catalogue.

Academic lifecycle enforcement, application/evidence workflows, supervisor
verification and appointment controls, five analytics cohorts, demo audience
isolation and the resumable Auth Admin seeder are implemented locally. The
private `presentation-2026` preview contains 1,600 Student-role accounts, 64 extra
mentors and two demo staff accounts: 1,666 accounts, including 750 eligible mentees.
The seeder includes current and historical scenarios, verification, selected
presentation logins and cleanup restricted to tracked batch records.

Legacy matches with unknown academic years remain available until supervisor
review; the migration does not guess their year or silently sever access.
Reviewed/new matches expire at the end of their recorded academic year. New
allocations require verified first-time undergraduate eligibility.

The user installed the SQL and configured the local administrative credential.
The live contract checks passed and all 1,666 accounts plus the planned demo
activity have been created. The batch report confirms 600 matches, 160 total
applications, 50 messages, 16 calendar events, 32 attendance records, eight
cancellation requests and two notices, with no detected notification leaks,
cross-cohort matches, capacity violations or early first-year approvals.

Population verification passed, including real sign-in for all 98 selected
presentation accounts. The user installed
`database/20261019050000_dashboard_read_performance.sql`; its live contract and
access checks now pass. Both staff directories load all 1,702 current profiles,
all ten analytics totals match their details, students/mentors see only their
faculty's non-cancelled demo events, supervisors can open mentor evidence, and
student access to admin/seed functions is explicitly rejected. Expired demo
notices are inactive. The final combined verification command passed, refreshed
all 98 presentation sign-ins, checked population and role access, and recorded
completion. No further SQL installation is pending for this demo setup. See
[database/DEMO_DEPLOYMENT.md](database/DEMO_DEPLOYMENT.md) for commands. All policy
and initial all-programme scope choices are confirmed; no further scope approval
is needed.
