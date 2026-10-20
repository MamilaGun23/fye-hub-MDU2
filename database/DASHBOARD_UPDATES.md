# Dashboard workflow update

The frontend changes require the database changes below. They have been tested in an isolated PostgreSQL fixture, not applied to the live Supabase project.

For an existing deployment with migrations through `20261009000000` already applied:

1. Apply `20261010000000_faculty_events_and_dashboard_details.sql` in the Supabase SQL editor. This migration runs in a transaction.
2. Apply `20261011000000_notice_expiry_schedule.sql` using the **postgres** role in Supabase's SQL editor. It now enables **pg_cron** before registering the expiry job. If extension installation is restricted, enable pg_cron under **Integrations → Cron** first, then rerun this migration. The job stops expired notices every minute, even when no dashboards are open.
3. Reload the dashboards. If Supabase Realtime is available, calendar and notification changes refresh connected calendars immediately. A one-minute polling fallback is also present.

Use the individual new migrations for this update. `RUN_ALL_LATEST_CHANGES.sql` also contains earlier changes, including destructive statements from older migrations; it is not an upgrade script to rerun blindly. The repository still lacks the original foundational schema.

For the project-wide update labels and unified sign-in changes dated 20 October
2026, apply `20261020000000_update_titles.sql` after the migrations already
installed, then reload the frontend. This migration carries each selected update
title into supervisor notifications and replaces their previous generic heading
in existing notifications. Existing update content, notification dates and read
state are preserved. Student and mentor notifications already use the selected
title. If installing `DEMO_INSTALL.sql` afresh, this migration is included.

## Resulting workflows

- **Mentor applications:** search and combine application filters, then clear them to restore the list. Pending/declined applications remain in the main list. Shortlisted candidates appear in their own final-review section, with Approve/Decline under the three-dot menu.
- **Assignments:** mentor cards show assignment counts. Student lists and the full matches table remain collapsed until the supervisor opens them.
- **Event request:** approving a pending request publishes it to the calendar and removes it from the pending workspace. Published event and attendance controls are on **Event calendar**, separate from **Event request**.
- **Faculty events:** a mentor request inherits the mentor's faculty; approval requires the mentor to remain active and in that faculty. Calendar access, notification delivery, and QR/manual check-in enforce faculty membership in the database. Supervisor-created university events remain university-wide. Legacy mentor events without a faculty are withheld from student calendars until their data can be corrected.
- **Cancellation:** mentor submits a reason → supervisor approves or declines → on approval, supervisor opens the calendar and chooses **••• → Remove event from calendar**. The approved reason is prefilled. Removal cancels the event, removes future reminders, updates calendars, and notifies affected active students and mentors. Event/attendance history is retained for reporting.
- **Attendance:** the QR sent to the requesting mentor uses the published event's attendance token. Valid QR and manual records feed supervisor totals and admin event reports. Student attendance and total attendance (including mentors) are shown separately.
- **Admin analytics:** click a metric or **View details** for its records; each metric also has **Generate report** for a CSV export. Click an event title to inspect/export attendance. Programme student/mentor counts expand into account lists; selecting a name opens account details. User-account names also open the same viewer.
- **Updates:** choose **University update** or **Application updates** as the title, then an end date/time or a duration of 1–365 days. The selected title appears in banners and recipient notifications. Expired banners disappear at their stop time, analytics exclude them immediately, and the scheduled sweep clears their active flag. Expired updates cannot be reactivated without extending their end time.
- **Sign in:** one form uses the authenticated profile and active mentor appointment to choose the dashboard. Existing sessions resume automatically. Direct links to another dashboard redirect to the correct one without signing the user out. All dashboard data loads wait for that shared account check; sign-out works across all roles and tabs. QR attendance links return to the scanned event after sign-in.
- **Actions:** administrative row actions and supervisor review/event-edit/correction actions are collapsed behind accessible three-dot menus. Escape and clicking outside close a menu.

## Verification after deployment

Check an approved faculty event using test accounts from two faculties; confirm only the intended faculty can see/check into it. Scan its QR twice and confirm attendance counts once. Confirm an admin can inspect its attendance without granting student accounts access to admin report RPCs. Complete the cancellation approval/removal flow and confirm other open calendars refresh. Finally, create a short-lived notice and confirm its banner disappears and `is_active` becomes false after the scheduled sweep.

`npm test` runs the earlier regression tests, DOM workflow tests using jsdom, and the isolated PostgreSQL migration/RLS tests using PGlite. These are development-only dependencies. Visual layout, real Realtime delivery, pg_cron execution, and the deployed project's existing policies still need live verification.
