import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";

export type Delegation = { userId: string; userName: string; delegateId: string; delegateName: string; endDate: string };

/** Leave periods active today (Riyadh calendar), keyed by the absent user. */
export async function activeDelegations(): Promise<Map<string, Delegation>> {
  const r = await db.execute(sql`
    SELECT l.user_id, u.name AS user_name, l.delegate_id, d.name AS delegate_name, l.end_date::text AS end_date
      FROM leave_periods l JOIN users u ON u.id = l.user_id JOIN users d ON d.id = l.delegate_id
     WHERE l.cancelled_at IS NULL AND d.is_active
       AND (now() AT TIME ZONE 'Asia/Riyadh')::date BETWEEN l.start_date AND l.end_date`);
  const map = new Map<string, Delegation>();
  for (const row of r.rows as { user_id: string; user_name: string; delegate_id: string; delegate_name: string; end_date: string }[]) {
    map.set(row.user_id, { userId: row.user_id, userName: row.user_name, delegateId: row.delegate_id, delegateName: row.delegate_name, endDate: row.end_date });
  }
  return map;
}
