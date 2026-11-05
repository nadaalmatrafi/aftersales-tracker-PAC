import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { canSeeConfidential, isCompanyManager, isExecutive, seesAllActions, selfAndDelegators, type CurrentUser } from "./auth";

const idList = (ids: (string | number)[]) => sql.join(ids.map((i) => sql`${i}`), sql`, `);

/**
 * SQL predicate restricting `action_plans a` to rows the user may see.
 * Enforced on every read path (lists, dashboards, reports, exports, attachments).
 * A delegate sees what the people they are covering for would see as "involved".
 */
export function actionVisibility(u: CurrentUser): SQL {
  const me = idList(selfAndDelegators(u));
  const involved = sql`(
    a.owner_id IN (${me}) OR a.assigned_by_id IN (${me}) OR a.created_by IN (${me})
    OR EXISTS (SELECT 1 FROM action_contributors c WHERE c.action_id = a.id AND c.user_id IN (${me}))
    OR EXISTS (SELECT 1 FROM action_steps s WHERE s.action_id = a.id AND s.assignee_id IN (${me}))
  )`;
  const confidential = canSeeConfidential(u) ? sql`TRUE` : sql`(NOT a.is_confidential OR ${involved})`;

  let scope: SQL;
  if (seesAllActions(u)) {
    scope = sql`TRUE`;
  } else if (isCompanyManager(u)) {
    const orgs = u.orgIds.length ? idList(u.orgIds) : sql`-1`;
    scope = sql`(${involved} OR EXISTS (SELECT 1 FROM action_organizations ao WHERE ao.action_id = a.id AND ao.organization_id IN (${orgs})))`;
  } else if (u.role === "director") {
    const dept = u.departmentId ?? -1;
    scope = sql`(${involved}
      OR a.department_id = ${dept}
      OR a.department_id IN (SELECT id FROM departments WHERE director_id = ${u.id})
      OR EXISTS (SELECT 1 FROM action_departments ad WHERE ad.action_id = a.id
                 AND (ad.department_id = ${dept} OR ad.department_id IN (SELECT id FROM departments WHERE director_id = ${u.id})))
      OR EXISTS (SELECT 1 FROM action_steps s WHERE s.action_id = a.id
                 AND (s.department_id = ${dept} OR s.department_id IN (SELECT id FROM departments WHERE director_id = ${u.id})))
      OR a.owner_id IN (SELECT id FROM users WHERE manager_id = ${u.id}))`;
  } else if (u.role === "manager") {
    scope = sql`(${involved}
      OR a.owner_id IN (SELECT id FROM users WHERE manager_id = ${u.id})
      OR EXISTS (SELECT 1 FROM action_steps s JOIN users su ON su.id = s.assignee_id
                 WHERE s.action_id = a.id AND su.manager_id = ${u.id}))`;
  } else {
    scope = involved;
  }
  return sql`(a.deleted_at IS NULL AND ${scope} AND ${confidential})`;
}

export type ActionAccessRow = {
  id: number;
  ownerId: string;
  assignedById: string | null;
  createdBy: string | null;
  departmentId: number | null;
  departmentDirectorId: string | null;
  contributorIds: string[];
  stepAssigneeIds: string[];
  orgIds: number[];
  status: string;
};

const overlaps = (a: number[], b: number[]) => a.some((x) => b.includes(x));

export function canManageAction(u: CurrentUser, a: ActionAccessRow) {
  if (isExecutive(u) || u.permissions.has("assign_any")) return true;
  if (isCompanyManager(u) && overlaps(u.orgIds, a.orgIds)) return true;
  if (a.assignedById === u.id || a.createdBy === u.id) return true;
  if (u.role === "director" && (a.departmentDirectorId === u.id || (u.departmentId != null && u.departmentId === a.departmentId)))
    return true;
  return false;
}
export function isActionOwner(u: CurrentUser, a: ActionAccessRow) {
  return selfAndDelegators(u).includes(a.ownerId);
}
export function canUpdateAction(u: CurrentUser, a: ActionAccessRow) {
  const ids = selfAndDelegators(u);
  return canManageAction(u, a) || ids.includes(a.ownerId) || a.contributorIds.some((c) => ids.includes(c)) || a.stepAssigneeIds.some((s) => ids.includes(s));
}
export function canReassignAction(u: CurrentUser, a: ActionAccessRow) {
  return canManageAction(u, a) || isActionOwner(u, a);
}
export function canManageSteps(u: CurrentUser, a: ActionAccessRow) {
  if (canManageAction(u, a)) return true;
  if (!isActionOwner(u, a)) return false;
  return u.role === "director" || u.permissions.has("assign_subtasks");
}
/**
 * Approvers: whoever assigned the action, or anyone above them (department director, company manager,
 * approve_completion holders such as Abdullah Qadi, CEO, System Owner). Nobody approves their own request.
 */
export function canApproveAction(u: CurrentUser, a: ActionAccessRow, requestedBy?: string | null) {
  if (requestedBy && requestedBy === u.id) return false;
  if (isExecutive(u) || u.permissions.has("approve_completion")) return true;
  if (isCompanyManager(u) && overlaps(u.orgIds, a.orgIds)) return true;
  const ids = selfAndDelegators(u);
  if (a.assignedById && ids.includes(a.assignedById)) return true;
  if (a.departmentDirectorId && ids.includes(a.departmentDirectorId)) return true;
  return false;
}
/** Management above the work may ask the current holder for an update. */
export function canRequestUpdate(u: CurrentUser, a: ActionAccessRow) {
  return seesAllActions(u) || canManageAction(u, a);
}
export function canDeleteAction(u: CurrentUser) {
  return isExecutive(u);
}
