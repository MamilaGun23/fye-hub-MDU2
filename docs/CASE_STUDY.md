# FYE Hub: leading a student support platform

**Role:** Project lead and primary contributor<br>
**Technologies:** JavaScript, Node.js, Express, Supabase, PostgreSQL

## Problem

First-year support depends on several connected activities: matching students with mentors, maintaining communication, coordinating events, and giving staff oversight. FYE Hub brings those activities into shared, role-specific workspaces.

## My contribution

I led the project, contributed the majority of the implementation, and decided which features to build. I guided how those features fit together and how actions were controlled across student, mentor, supervisor, and admin roles.

My focus included feature prioritisation, implementation direction, and the review steps around mentor applications, student assignments, and campus events.

## Key decisions

| Decision | Reason |
| --- | --- |
| One sign-in with role-aware routing | Users reach the workspace appropriate to their account and current mentor appointment. |
| Explicit approval workflows | Supervisors can review applications and event requests before they take effect. |
| Database-backed business rules | PostgreSQL functions and policies apply permissions and validation close to the data. |
| A small frontend stack | Plain JavaScript and shared modules keep the interface approachable and easy to inspect. |

## Delivered capabilities

- Four connected workspaces for student support and programme administration.
- Mentor application review, student matching, and contact tracking.
- Messaging, notices, event management, and attendance reporting.
- Automated regression coverage and desktop/mobile browser checks.

[View the application screenshots](SCREENSHOTS.md) · [Explore the architecture](ARCHITECTURE.md)

## Next improvements

Complete the reproducible base database schema, strengthen frontend module boundaries, and expand accessibility testing across authenticated workflows.
