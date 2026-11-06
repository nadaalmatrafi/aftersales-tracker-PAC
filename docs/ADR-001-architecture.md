# ADR-001 — Business Performance system architecture

Status: Accepted (sandbox build) · Date: 2026-11-05 · Skills applied: nada-architecture, nada-ui-design, nada-quality-gate

## Context
PAC, PCVC and DEX (after-sales only) run CEO-driven action plans across department directors and their teams.
A request can sit with one team or pass through several departments. The CEO needs to see, for each action:
what it is, who owns it, **who it is currently waiting on**, what remains, and the measurable impact.

The specification references an existing production deployment (performance.epms-pac.com) and EPMS/Audit systems.
None of these were reachable from the build environment, so this build is a sandbox implementation designed to be
installed **alongside** production with additive migrations and an idempotent seed. No production system was changed.

## Options considered
1. Static dashboard over spreadsheets — rejected (no accountability, no history, spec forbids static figures).
2. SPA + BaaS (Supabase client SDK with RLS) — viable, but puts business rules in policies and the browser.
3. **Next.js server-rendered app + PostgreSQL via Drizzle, all authorization on the server** — selected.
   Same stack as the owner's earlier project (Next 16, Drizzle, `pg`), works with Supabase Postgres or any Postgres.

## Design
- Layers: `app/` (UI + server actions) → `lib/` (domain rules, access, services) → `db/` (schema, client).
  Integrations (`lib/email.ts`, `lib/calendar.ts`) are isolated and degrade safely when not configured.
- Auth: email + password (scrypt), opaque session tokens stored hashed in `sessions`, httpOnly/SameSite=Lax cookies.
  EPMS single sign-on endpoint `/api/auth/epms` accepts an HMAC-signed token and links to an **existing** user only
  (no duplicate accounts).
- Roles: system_owner, ceo, director, manager, employee + per-user permission grants (`user_permissions`), e.g.
  Abdullah Qadi holds `view_all_actions`, `assign_any`, `manage_meetings`, `approve_completion`.
- Visibility (server-enforced in SQL): owner/CEO/view_all see everything; directors see their organizations'
  actions touching their department; managers see their own and their direct reports' actions; employees see actions
  they are involved in. Confidential items are restricted to executives and directly involved users.
- Action plan model: one `point_task` field; many organizations; a primary department plus supporting departments;
  ordered **workflow steps** (each with department, assignee, due date, status). "Waiting on" is derived:
  pending approval → approver; otherwise first open step's assignee; otherwise the accountable owner.
- Status: stored statuses exclude "Overdue"; Overdue is derived (target date < today in Asia/Riyadh and not
  completed/cancelled). Progress is derived from steps when steps exist.
- History: ownership changes in `action_assignments`, progress in `action_updates`, every mutation in `audit_logs`.
  Deletion is a soft delete (retention); only the System Owner can purge.
- Approvals: completion and deadline-extension requests in `approval_records`, decided by an authorized approver.
- Notifications: in-app rows with a unique `dedupe_key` (prevents duplicates) + optional Resend email,
  per-user preferences. Reminder sweep at `/api/cron/reminders` (secret-protected).
- Calendar: Google Calendar via service account with a deterministic event id per meeting (no duplicates on retry);
  `.ics` download when not configured.
- Attachments: stored in PostgreSQL `bytea` (10 MB cap), served only through an authorization-checked route.
- Reports: server-generated Excel (exceljs) and PDF (jsPDF), using the same visibility filter as the UI.

## Initial data
`scripts/seed.mjs` inserts organizations and the 14 initial action plans only if an action with the same text does not
exist; it never updates or deletes. Original timelines are kept as text (`timeline_note`); target dates are left empty
because none of the source timelines is a calendar date. Suggested owners are kept in `suggested_responsible`.

## Rollback
All migrations add tables only. Rollback = stop the new app and restore the pre-migration `pg_dump`
(`scripts/backup.sh`, `scripts/restore-test.sh`). Production must not be touched without explicit approval.

## Revision 2 — 2026-11-05 (owner review)
- Added role `company_manager` (one per company, scoped by company access) between CEO and directors; sees, creates, distributes,
  approves and escalates for their company. Abdullah Qadi keeps view-all + approve rights.
- Approval rule: assigner or anyone above; self-approval blocked for every role.
- Hierarchy People filter replaces search on Action Plans; Status and Company filters added.
- Landing page "My Work"; dashboard renamed "Overview"; 30/60/90 objectives moved into Overview as a compact card + in-place checklist.
- Removed meetings (pages, Google Calendar integration, meeting report and reminders). Tables remain for data preservation.
- Added: request-update notifications, daily no-progress alert to the holder's manager (configurable days), leave periods with delegates
  (`leave_periods`), username sign-in (`users.username`), one-page CEO PDF.
- Migration `0001_hierarchy_username_leave.sql` is additive only (enum value, nullable column, new table).
- Visual identity: Petromin Auto Care logo, white background, logo colours; status colours unchanged.

## Revision 3 — 2026-11-06 (owner review)
- Approvals removed entirely: approvals happen outside the system, which is for follow-up only. No completion approval, no deadline-extension
  requests, no deliverable approval. The owner or management marks an action completed; a deliverable is done when completed with evidence.
  `approval_records` stays in the schema (unused) so no data is lost; the `pending_approval` enum value is no longer reachable.
- The separate "Post progress update" form was removed; "Add step" became **Update** (stage, department, assignee, due) and is open to everyone
  involved in the action. Management can still set status (on hold, cancelled, completed) from Edit.
- Status filter is multi-select; "Pending Management Decisions" report replaced by an Escalations report.
