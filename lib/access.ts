import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { canSeeConfidential, isExecutive, seesAllActions, type CurrentUser } from "./auth";

/**
 * SQL predicate restricting `action_plans a` to rows the user may see.
 * Enforced on every read path (lists, dashboard, reports, exports, attachments).
 */
export function actionVisibility(u: CurrentUser): SQL {
  const involved = sql`(
    a.owner_id = ${u.id} OR a.assigned_by_id = ${u.id} OR a.created_by = ${u.id}
    OR EXISTS (SELECT 1 FROM action_contributors c WHERE c.action_id = a.id AND c.user_id = ${u.id})
    OR EXISTS (SELECT 1 FROM action_steps s WHERE s.action_id = a.id AND s.assignee_id = ${u.id})
  )`;
  const confidential = canSeeConfidential(u) ? sql`TRUE` : sql`(NOT a.is_confidential OR ${involved})`;

  let scope: SQL;
  if (seesAllActions(u)) {
    scope = sql`TRUE`;
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

export function meetingVisibility(u: CurrentUser): SQL {
  if (isExecutive(u) || u.permissions.has("manage_meetings") || u.permissions.has("view_all_actions")) {
    return canSeeConfidential(u) ? sql`TRUE` : sql`(NOT m.is_confidential OR m.created_by = ${u.id})`;
  }
  return sql`(m.created_by = ${u.id} OR EXISTS (SELECT 1 FROM meeting_attendees ma WHERE ma.meeting_id = m.id AND ma.user_id = ${u.id}))`;
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
  status: string;
};

export function canManageAction(u: CurrentUser, a: ActionAccessRow) {
  if (isExecutive(u) || u.permissions.has("assign_any")) return true;
  if (a.assignedById === u.id || a.createdBy === u.id) return true;
  if (u.role === "director" && (a.departmentDirectorId === u.id || (u.departmentId != null && u.departmentId === a.departmentId)))
    return true;
  return false;
}
export function isActionOwner(u: CurrentUser, a: ActionAccessRow) {
  return a.ownerId === u.id;
}
export function canUpdateAction(u: CurrentUser, a: ActionAccessRow) {
  return canManageAction(u, a) || isActionOwner(u, a) || a.contributorIds.includes(u.id) || a.stepAssigneeIds.includes(u.id);
}
export function canReassignAction(u: CurrentUser, a: ActionAccessRow) {
  return canManageAction(u, a) || isActionOwner(u, a);
}
export function canManageSteps(u: CurrentUser, a: ActionAccessRow) {
  if (canManageAction(u, a)) return true;
  if (!isActionOwner(u, a)) return false;
  return u.role === "director" || u.permissions.has("assign_subtasks");
}
/** No self-approval unless executive. */
export function canApproveAction(u: CurrentUser, a: ActionAccessRow, requestedBy?: string | null) {
  if (isExecutive(u)) return true;
  if (requestedBy && requestedBy === u.id) return false;
  if (u.permissions.has("approve_completion")) return true;
  if (a.assignedById === u.id) return true;
  if (a.departmentDirectorId === u.id) return true;
  return false;
}
export function canDeleteAction(u: CurrentUser) {
  return isExecutive(u);
}
