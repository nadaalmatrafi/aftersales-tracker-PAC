import "server-only";
import { db, schema } from "@/db";
import { clientIp } from "./auth";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function audit(
  actorId: string | null,
  entityType: string,
  entityId: string | number,
  action: string,
  changes?: Record<string, unknown>,
  tx?: Tx,
) {
  let ip: string | null = null;
  try {
    ip = await clientIp();
  } catch {
    ip = null; // outside a request (cron/scripts)
  }
  await (tx ?? db).insert(schema.auditLogs).values({
    actorId,
    entityType,
    entityId: String(entityId),
    action,
    changes: changes ?? null,
    ip,
  });
}

/** Returns only the fields whose values changed, as {field: {from, to}}. */
export function diff<T extends Record<string, unknown>>(before: T, after: Partial<T>) {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of Object.keys(after)) {
    const a = before[k];
    const b = after[k];
    const norm = (v: unknown) => (v instanceof Date ? v.toISOString() : v === undefined ? null : v);
    if (JSON.stringify(norm(a)) !== JSON.stringify(norm(b))) out[k] = { from: norm(a), to: norm(b) };
  }
  return out;
}
