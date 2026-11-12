# Database

Supabase PostgreSQL provides application data, row-level policies, and workflow functions. Auth and Storage support accounts and uploaded files.

## Prerequisites

The migrations assume an existing schema containing profiles, faculties, programmes, mentor assignments, calendar events, system notices, and account-provisioning triggers. A full base schema for a new project is not yet included.

## Migration files

Timestamped files record changes to approval workflows, attendance, messaging, academic lifecycle rules, and reporting. Review the current database state before applying them in order.

- `DEMO_INSTALL.sql` combines the later academic and demo-cohort migrations for a compatible existing database. Use the combined installer or its constituent files, not both.
- `DEMO_READ_ONLY_AUDIT.sql` exports the schema/catalogue information used by the local demo tools.
- `RUN_ALL_LATEST_CHANGES.sql` is a historical aggregate containing destructive table rebuilds. It is not a bootstrap or a safe script to rerun against populated data.

The historical communication migration also rebuilds messaging and contact tables. Review changes and back up data before applying migrations to a populated project.

See [demo tooling](../scripts/demo/README.md) for audit, preview, seed, and verification commands.
