import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { DEFAULT_STALE_ALERT_DAYS } from "./constants";

/** Days without an update before the current holder's manager is alerted (System Settings). */
export async function staleAlertDays(): Promise<number> {
  const r = await db.execute(sql`SELECT value FROM system_settings WHERE key = 'stale_alert_days'`);
  const v = Number((r.rows[0] as { value?: unknown } | undefined)?.value);
  return Number.isInteger(v) && v >= 1 && v <= 60 ? v : DEFAULT_STALE_ALERT_DAYS;
}
