import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { meetingVisibility } from "@/lib/access";
import { meetingIcs } from "@/lib/calendar";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const u = await getCurrentUser();
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const r = await db.execute(sql`SELECT m.* FROM meetings m WHERE m.id = ${id} AND ${meetingVisibility(u)}`);
  const m = r.rows[0] as Record<string, unknown> | undefined;
  if (!m) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const att = await db.execute(sql`SELECT u.email, u.name FROM meeting_attendees a JOIN users u ON u.id = a.user_id WHERE a.meeting_id = ${id}`);
  const ics = meetingIcs({
    id,
    title: m.title as string,
    start: new Date(m.meeting_at as string),
    durationMinutes: m.duration_minutes as number,
    agenda: m.agenda as string | null,
    location: m.location as string | null,
    meetingLink: m.meeting_link as string | null,
    attendees: att.rows as { email: string; name: string }[],
    cancelled: m.status === "cancelled",
  });
  return new NextResponse(ics, { headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `attachment; filename="meeting-${id.slice(0, 8)}.ics"`, "Cache-Control": "private, no-store" } });
}
