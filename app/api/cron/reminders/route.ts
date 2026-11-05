import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { notify, escalationRecipients } from "@/lib/notify";
import { listActions } from "@/lib/queries";
import { addDaysISO, fmtDate, todayISO } from "@/lib/dates";
import { staleAlertDays } from "@/lib/settings";
import type { CurrentUser } from "@/lib/auth";

/** Read-only system identity used to evaluate every action (never used for writes). */
const SYSTEM: CurrentUser = {
  id: "00000000-0000-0000-0000-000000000000",
  name: "System",
  email: "",
  role: "system_owner",
  title: null,
  departmentId: null,
  managerId: null,
  mustChangePassword: false,
  permissions: new Set(),
  orgIds: [],
  actingFor: [],
};

/** Direct manager of a user: their manager, else their department director, else their company manager. */
async function managerOf(userId: string): Promise<string | null> {
  const r = await db.execute(sql`
    SELECT COALESCE(
      (SELECT m.id FROM users m WHERE m.id = u.manager_id AND m.is_active),
      (SELECT d.director_id FROM departments d JOIN users dir ON dir.id = d.director_id WHERE d.id = u.department_id AND d.director_id <> u.id AND dir.is_active),
      (SELECT cm.id FROM users cm JOIN user_organizations uo ON uo.user_id = cm.id JOIN departments d2 ON d2.organization_id = uo.organization_id
        WHERE d2.id = u.department_id AND cm.role = 'company_manager' AND cm.is_active AND cm.id <> u.id LIMIT 1)
    ) AS mgr FROM users u WHERE u.id = ${userId}`);
  return (r.rows[0] as { mgr: string | null } | undefined)?.mgr ?? null;
}

/** Daily sweep. Dedupe keys make re-runs safe: each reminder is sent at most once per period. */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || given.length !== secret.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(secret)))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const today = todayISO();
  const week = `${today.slice(0, 4)}-w${Math.ceil((Number(new Date(`${today}T00:00:00Z`)) - Date.UTC(Number(today.slice(0, 4)), 0, 1)) / 604_800_000 + 1)}`;
  let dueSoon = 0,
    overdue = 0,
    stale = 0;

  const soon = await db.execute(sql`SELECT a.id, a.code, a.point_task, a.owner_id, a.target_date::text AS t FROM action_plans a
    WHERE a.deleted_at IS NULL AND a.status NOT IN ('completed','cancelled') AND a.target_date BETWEEN ${today}::date AND ${addDaysISO(today, 3)}::date`);
  for (const a of soon.rows as { id: number; code: string; point_task: string; owner_id: string; t: string }[]) {
    await notify({ userIds: [a.owner_id], type: "deadline_soon", title: `Deadline approaching: ${a.code} (${fmtDate(a.t)})`, body: a.point_task, link: `/actions/${a.id}`, dedupeKey: `due_soon:${a.id}:${a.t}` });
    dueSoon++;
  }

  const late = await db.execute(sql`SELECT a.id, a.code, a.point_task, a.owner_id, a.assigned_by_id, a.target_date::text AS t FROM action_plans a
    WHERE a.deleted_at IS NULL AND a.status NOT IN ('completed','cancelled') AND a.target_date < ${today}::date`);
  for (const a of late.rows as { id: number; code: string; point_task: string; owner_id: string; assigned_by_id: string | null; t: string }[]) {
    await notify({ userIds: [a.owner_id, a.assigned_by_id], type: "overdue", title: `Overdue: ${a.code} — target was ${fmtDate(a.t)}`, body: `${a.point_task}\n\nPost an update, request an extension or escalate.`, link: `/actions/${a.id}`, dedupeKey: `overdue:${a.id}:${week}` });
    overdue++;
  }

  // No-progress alert: an action sitting with the same person for N days without any update alerts that person's manager.
  const days = await staleAlertDays();
  const cutoff = Date.now() - days * 86_400_000;
  const rows = await listActions(SYSTEM, {});
  for (const a of rows) {
    if (a.waiting_reason === "closed" || !a.waiting_on_id) continue;
    const last = Math.max(...[a.last_update_at, a.waiting_since, a.created_at].filter(Boolean).map((v) => new Date(v as string).getTime()));
    if (last > cutoff) continue;
    const holder = a.waiting_on_id;
    const mgr = await managerOf(holder);
    const recipients = mgr && mgr !== holder ? [mgr] : (await escalationRecipients()).filter((x) => x !== holder);
    const idleDays = Math.floor((Date.now() - last) / 86_400_000);
    await notify({
      userIds: recipients,
      type: "stale_alert",
      title: `No progress for ${idleDays} days: ${a.code}`,
      body: `${a.point_task}\n\nCurrently with ${a.waiting_on_name}${a.acting_for ? ` (covering for ${a.acting_for})` : ""}${a.waiting_on_step ? ` — ${a.waiting_on_step}` : ""}. No update since ${fmtDate(new Date(last))}.`,
      link: `/actions/${a.id}`,
      dedupeKey: `stale:${a.id}:${holder}:${new Date(last).toISOString().slice(0, 10)}`,
    });
    stale++;
  }
  return NextResponse.json({ ok: true, dueSoon, overdue, stale, staleAfterDays: days });
}
