# Business Performance — PAC | PCVC | DEX

Executive action-plan and performance management for after-sales operations. The CEO assigns requests; Abdullah Qadi
distributes them to directors; directors break them into **workflow steps across teams and departments**. At any moment
the CEO sees **what is being done, who it is currently with, what remains, and the measured impact**.

Architecture and decisions: [`docs/ADR-001-architecture.md`](docs/ADR-001-architecture.md) · Screenshots: [`docs/screenshots`](docs/screenshots)

## Modules
| Module | What it does |
|---|---|
| My Work (landing page) | What is waiting on me: steps with me, approvals I may decide, my actions currently with others, my objective deliverables, latest notifications, leave/cover banners |
| Overview | KPI cards, Status/Company/People/Priority/Period filters, small 30/60/90 card that opens the checklist in place, "Requires attention" with current holder, bottleneck table, charts, business-impact summary, one-page CEO PDF — all from database records |
| Action Plans | Single **Point / Task** field, multiple organizations, primary + supporting departments, contributors, ordered workflow steps with hand-off notifications, blockers, progress updates, comments, evidence files, completion approval, deadline-extension requests, escalation to CEO, reassignment with preserved history, soft delete with restore, full audit trail. *Overdue* is derived, never stored |
| 30/60/90 Objectives | Inside Overview: checklist deliverables with responsible person, deadline, evidence (note/file) and manager approval; completion counts approved deliverables only |
| Request update | Management above an action asks the current holder for an update (one notification per requester/holder/day) |
| No-progress alert | Daily: an action sitting with the same person for N days (default 3, System Settings) alerts that person's manager |
| Leave & delegate | Account › Leave: during the leave the delegate holds the person's steps and approvals and gets a copy of notifications; "Currently with" shows "covering for" |
| Reports | 9 reports + one-page CEO summary, Excel and PDF export honouring filters and permissions |
| Notifications | In-app + Resend email, per-user and organization-wide preferences, de-duplicated; daily reminder sweep (`/api/cron/reminders`) |
| Administration | Users (email and optional username sign-in), roles incl. Company Manager (one per company), per-user permissions, company access, departments & directors, audit log, settings, deleted-record restore |

No approvals: this system is for follow-up only (approvals happen outside it). Progress is recorded as **Updates** (stage, department, person);
the owner or management presses **Mark as completed**. The Status filter is multi-select.

Hierarchy: CEO → Company managers (PAC, PCVC, DEX) → Department directors → Managers → Employees. The People filter shows the level
directly below the user (System Owner and Abdullah Qadi see everyone; employees have no People filter). Branding: Petromin Auto Care logo, white background,
logo colours only (red #ce102c, orange #fb8606, black #171614); status colours keep their meaning. Meetings were removed at the owner's request
(tables are kept, unused, so no data is lost).

Roles: System Owner, CEO, Company Manager, Director, Manager, Employee (+ grants such as `view_all_actions`, `assign_any`, `approve_completion`).
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
npm run test:e2e                # 61 end-to-end checks against a running server on the demo database
npm run db:backup && npm run db:restore-test -- backups/<file>.dump postgres://user:pass@host:5432/postgres
```

## Production notes (not yet done — requires approval)
- Point `DATABASE_URL` at the production Postgres (Supabase is supported). Take and verify a backup **before** running `db:migrate`.
- Configure `RESEND_API_KEY`, `MAIL_FROM`, `APP_BASE_URL`, `CRON_SECRET` and `EPMS_SSO_SECRET` as server-side secrets.
- EPMS single sign-on: EPMS redirects to `/api/auth/epms?token=…` (HMAC-signed, 5-minute expiry, single use); it links only to existing accounts.
- Audit System: add a navigation link to `https://performance.epms-pac.com/` (and optionally the SSO URL).
- Organization assignment of the 14 initial actions defaults to PAC (item 14: PAC + PCVC) and needs confirmation.
