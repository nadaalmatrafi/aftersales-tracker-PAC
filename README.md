# Business Performance — PAC | PCVC | DEX

Executive action-plan and performance management for after-sales operations. The CEO assigns requests; Abdullah Qadi
distributes them to directors; directors break them into **workflow steps across teams and departments**. At any moment
the CEO sees **what is being done, who it is currently with, what remains, and the measured impact**.

Architecture and decisions: [`docs/ADR-001-architecture.md`](docs/ADR-001-architecture.md) · Screenshots: [`docs/screenshots`](docs/screenshots)

## Modules
| Module | What it does |
|---|---|
| Executive Dashboard | 10 KPI cards, 8 filters, "Requires attention" with current holder, bottleneck table, trend/organization/director/department/overdue/objective charts, business-impact summary — all calculated from database records |
| Action Plans | Single **Point / Task** field, multiple organizations, primary + supporting departments, contributors, ordered workflow steps with hand-off notifications, blockers, progress updates, comments, evidence files, completion approval, deadline-extension requests, escalation to CEO, reassignment with preserved history, soft delete with restore, full audit trail. *Overdue* is derived, never stored |
| CEO Meetings | Schedule, attendees, agenda, decisions (with "requires approval"), actions created from decisions, automatic carry-forward of unfinished actions, completed-since-last-meeting, attendance, minutes, Google Calendar sync (no duplicate events) or `.ics` |
| 30/60/90 Objectives | Checklist deliverables with responsible person, deadline, evidence (note/file) and manager approval; completion counts approved deliverables only |
| Reports | 10 reports, on-screen preview, Excel and PDF export honouring filters and permissions |
| Notifications | In-app + Resend email, per-user and organization-wide preferences, de-duplicated; daily reminder sweep (`/api/cron/reminders`) |
| Administration | Users, roles, per-user permissions, organization access, departments & directors, audit log, integration status, deleted-record restore |

Roles: System Owner, CEO, Director, Manager, Employee (+ grants such as `view_all_actions`, `assign_any`, `approve_completion`).
All authorization is enforced on the server in SQL; the UI only hides what the server already refuses.

## Run locally
```bash
cp .env.example .env            # fill DATABASE_URL and BOOTSTRAP_* values
npm ci
npm run db:migrate              # additive migrations only
npm run db:seed                 # idempotent: organizations, System Owner, Abdullah Qadi, 14 initial action plans
npm run build && npm start
```
Sign in with the bootstrap System Owner; you will be asked to change the password. Set Abdullah Qadi's password from
*Administration › Users & Permissions*.

## Quality checks
```bash
npm run lint && npm run typecheck && npm run build
npm run db:demo                 # DEMO DATABASE ONLY (name must contain "demo"/"test")
npm run test:e2e                # 36 end-to-end checks against a running server on the demo database
npm run db:backup && npm run db:restore-test -- backups/<file>.dump postgres://user:pass@host:5432/postgres
```

## Production notes (not yet done — requires approval)
- Point `DATABASE_URL` at the production Postgres (Supabase is supported). Take and verify a backup **before** running `db:migrate`.
- Configure `RESEND_API_KEY`, `MAIL_FROM`, `APP_BASE_URL`, `CRON_SECRET`, Google service-account variables and `EPMS_SSO_SECRET` as server-side secrets.
- EPMS single sign-on: EPMS redirects to `/api/auth/epms?token=…` (HMAC-signed, 5-minute expiry, single use); it links only to existing accounts.
- Audit System: add a navigation link to `https://performance.epms-pac.com/` (and optionally the SSO URL).
- Organization assignment of the 14 initial actions defaults to PAC (item 14: PAC + PCVC) and needs confirmation.
