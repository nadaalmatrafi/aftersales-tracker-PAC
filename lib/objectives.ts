import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { isExecutive, type CurrentUser } from "./auth";

/** Objectives: executives/managers-of-objectives see all; others see their organizations' objectives and items they own. */
export function objectiveVisibility(u: CurrentUser): SQL {
  if (isExecutive(u) || u.permissions.has("manage_objectives") || u.permissions.has("view_all_actions")) return sql`TRUE`;
  const orgs = u.orgIds.length ? sql.join(u.orgIds.map((o) => sql`${o}`), sql`, `) : sql`-1`;
  return sql`(o.organization_id IN (${orgs}) OR o.owner_id = ${u.id} OR o.created_by = ${u.id}
              OR EXISTS (SELECT 1 FROM objective_items oi WHERE oi.objective_id = o.id AND oi.responsible_id = ${u.id}))`;
}
