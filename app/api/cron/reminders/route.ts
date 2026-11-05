import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { notify } from "@/lib/notify";
import { addDaysISO, fmtDate, fmtDateTime, todayISO } from "@/lib/dates";

/** Daily reminder sweep. Dedupe keys make re-runs safe: each reminder is sent at most once per period. */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || given.length !== secret.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(secret)))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const today = todayISO();
  const week = `${today.slice(0, 4)}-w${Math.ceil((Number(new Date(`${today}T00:00:00Z`)) - Date.UTC(Number(today.slice(0, 4)), 0, 1)) / 604_800_000 + 1)}`;
  let dueSoon = 0, overdue = 0, meetings = 0;

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

  const m = await db.execute(sql`SELECT m.id, m.title, m.meeting_at, array_agg(ma.user_id::text) AS att FROM meetings m JOIN meeting_attendees ma ON ma.meeting_id = m.id
    WHERE m.status = 'scheduled' AND m.meeting_at BETWEEN now() AND now() + interval '36 hours' GROUP BY m.id`);
  for (const x of m.rows as { id: string; title: string; meeting_at: string; att: string[] }[]) {
    await notify({ userIds: x.att, type: "meeting", title: `Upcoming meeting: ${x.title}`, body: `${fmtDateTime(x.meeting_at)} (Riyadh time). Review your open actions before the meeting.`, link: `/meetings/${x.id}`, dedupeKey: `meeting_reminder:${x.id}:${new Date(x.meeting_at).toISOString()}` });
    meetings++;
  }
  return NextResponse.json({ ok: true, dueSoon, overdue, meetings });
}
