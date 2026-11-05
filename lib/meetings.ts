import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { CurrentUser } from "./auth";
import { meetingVisibility } from "./access";

export async function meetingOptions(u: CurrentUser) {
  const r = await db.execute(sql`SELECT m.id, m.title, to_char(m.meeting_at AT TIME ZONE 'Asia/Riyadh', 'YYYY-MM-DD') AS date
                                 FROM meetings m WHERE ${meetingVisibility(u)} ORDER BY m.meeting_at DESC LIMIT 100`);
  return r.rows as { id: string; title: string; date: string }[];
}
