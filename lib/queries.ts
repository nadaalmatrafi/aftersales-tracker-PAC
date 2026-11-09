import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { seesAllActions, type CurrentUser } from "./auth";
import { actionVisibility, type ActionAccessRow } from "./access";
import { todayISO } from "./dates";
import { activeDelegations } from "./leave";
import { STATUSES, PRIORITIES, REQUEST_TYPES, type Status } from "./constants";

export type ActionFilters = {
  org?: number;
  dept?: number;
  director?: string;
  owner?: string;
  /** Hierarchy filter: actions involving this person or the part of the organization they lead. */
  person?: string;
  /** One or more statuses (multi-select). */
  statuses?: Status[];
  priority?: string;
  from?: string;
  to?: string;
  q?: string;
  category?: string;
  /** Request type (report, sales increase, …). */
  type?: string;
  escalated?: boolean;
  stale?: boolean;
  dueSoon?: boolean;
  ids?: number[];
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f-]{36}$/i;

export function parseFilters(sp: Record<string, string | string[] | undefined>): ActionFilters {
  const g = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : (sp[k] as string | undefined)) || undefined;
  const int = (k: string) => {
    const v = Number(g(k));
    return Number.isInteger(v) && v > 0 ? v : undefined;
  };
  const all = (k: string) => (Array.isArray(sp[k]) ? (sp[k] as string[]) : sp[k] ? [sp[k] as string] : []);
  const statuses = [...new Set(all("status").filter((s) => (STATUSES as readonly string[]).includes(s)))] as Status[];
  const priority = g("priority");
  return {
    org: int("org"),
    dept: int("dept"),
    director: UUID.test(g("director") ?? "") ? g("director") : undefined,
    owner: UUID.test(g("owner") ?? "") ? g("owner") : undefined,
    person: UUID.test(g("person") ?? "") ? g("person") : undefined,
    statuses: statuses.length ? statuses : undefined,
    priority: (PRIORITIES as readonly string[]).includes(priority ?? "") ? priority : undefined,
    from: ISO.test(g("from") ?? "") ? g("from") : undefined,
    to: ISO.test(g("to") ?? "") ? g("to") : undefined,
    q: g("q")?.slice(0, 100),
    category: g("category"),
    type: (REQUEST_TYPES as readonly string[]).includes(g("type") ?? "") ? g("type") : undefined,
    escalated: g("escalated") === "1",
    stale: g("stale") === "1",
    dueSoon: g("dueSoon") === "1",
  };
}

export function effectiveStatusSql(today: string): SQL {
  return sql`(CASE WHEN a.status NOT IN ('completed','cancelled') AND a.target_date IS NOT NULL AND a.target_date < ${today}::date
               THEN 'overdue' ELSE a.status::text END)`;
}

export function filterSql(f: ActionFilters, today: string): SQL {
  const parts: SQL[] = [];
  if (f.org) parts.push(sql`EXISTS (SELECT 1 FROM action_organizations ao WHERE ao.action_id = a.id AND ao.organization_id = ${f.org})`);
  if (f.dept)
    parts.push(sql`(a.department_id = ${f.dept} OR EXISTS (SELECT 1 FROM action_departments ad WHERE ad.action_id = a.id AND ad.department_id = ${f.dept}))`);
  if (f.director) parts.push(sql`a.department_id IN (SELECT id FROM departments WHERE director_id = ${f.director})`);
  if (f.owner) parts.push(sql`a.owner_id = ${f.owner}`);
  if (f.statuses?.length) parts.push(sql`${effectiveStatusSql(today)} IN (${sql.join(f.statuses.map((s) => sql`${s}`), sql`, `)})`);
  if (f.priority) parts.push(sql`a.priority = ${f.priority}`);
  if (f.person)
    parts.push(sql`(a.owner_id = ${f.person} OR a.assigned_by_id = ${f.person}
      OR EXISTS (SELECT 1 FROM action_steps s WHERE s.action_id = a.id AND s.assignee_id = ${f.person})
      OR EXISTS (SELECT 1 FROM action_contributors c WHERE c.action_id = a.id AND c.user_id = ${f.person})
      OR a.department_id IN (SELECT id FROM departments WHERE director_id = ${f.person})
      OR EXISTS (SELECT 1 FROM action_steps s JOIN departments d ON d.id = s.department_id WHERE s.action_id = a.id AND d.director_id = ${f.person})
      OR EXISTS (SELECT 1 FROM users pu JOIN user_organizations uo ON uo.user_id = pu.id
                 JOIN action_organizations ao ON ao.organization_id = uo.organization_id
                 WHERE pu.id = ${f.person} AND pu.role = 'company_manager' AND ao.action_id = a.id))`);
  if (f.type) parts.push(sql`a.request_type = ${f.type}`);
  if (f.category) parts.push(sql`a.category::text = ${f.category}`);
  if (f.from) parts.push(sql`(a.created_at::date >= ${f.from}::date OR a.target_date >= ${f.from}::date)`);
  if (f.to) parts.push(sql`(a.created_at::date <= ${f.to}::date OR a.target_date <= ${f.to}::date)`);
  if (f.q) parts.push(sql`(a.point_task ILIKE ${"%" + f.q + "%"} OR a.code ILIKE ${"%" + f.q + "%"})`);
  if (f.escalated) parts.push(sql`(a.is_escalated AND a.status NOT IN ('completed','cancelled'))`);
  if (f.stale)
    parts.push(sql`(a.status NOT IN ('completed','cancelled') AND COALESCE(a.last_update_at, a.created_at) < now() - interval '7 days')`);
  if (f.dueSoon)
    parts.push(sql`(a.status NOT IN ('completed','cancelled') AND a.target_date BETWEEN ${today}::date AND ${today}::date + 7)`);
  if (f.ids?.length) parts.push(sql`a.id IN (${sql.join(f.ids.map((i) => sql`${i}`), sql`, `)})`);
  return parts.length ? sql.join(parts, sql` AND `) : sql`TRUE`;
}

export type ActionRow = {
  id: number;
  code: string;
  point_task: string;
  org_codes: string[];
  department: string | null;
  department_id: number | null;
  director_name: string | null;
  owner_id: string;
  owner_name: string;
  assigned_by_name: string | null;
  suggested_responsible: string | null;
  timeline_note: string | null;
  start_date: string | null;
  target_date: string | null;
  priority: string;
  status: string;
  effective_status: Status;
  progress: number;
  category: string | null;
  business_impact: string | null;
  request_type: string | null;
  /** Set while status = waiting: the outside party / decision the action is waiting for. */
  waiting_for: string | null;
  blocker: string | null;
  is_escalated: boolean;
  last_update_at: string | null;
  last_update_note: string | null;
  completed_at: string | null;
  created_at: string;
  steps_total: number;
  steps_done: number;
  waiting_on_id: string | null;
  waiting_on_name: string | null;
  waiting_on_dept: string | null;
  waiting_on_step: string | null;
  waiting_reason: "approval" | "external" | "step" | "owner" | "closed";
  /** Set when the holder is on leave: the name of the person the delegate is covering for. */
  acting_for: string | null;
  waiting_since: string | null;
  step_blocked: boolean;
  remaining_steps: string[];
};

/** Core list query: includes the derived "waiting on" hand-off position for each action. */
export async function listActions(u: CurrentUser, f: ActionFilters = {}, opts: { limit?: number; orderBy?: SQL } = {}) {
  const today = todayISO();
  const order =
    opts.orderBy ??
    sql`CASE ${effectiveStatusSql(today)} WHEN 'overdue' THEN 0 WHEN 'pending_approval' THEN 1 WHEN 'waiting' THEN 1 WHEN 'in_progress' THEN 2 WHEN 'not_started' THEN 3 WHEN 'on_hold' THEN 4 ELSE 5 END,
        CASE a.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, a.target_date NULLS LAST, a.id`;
  const res = await db.execute(sql`
    SELECT a.id, a.code, a.point_task, a.department_id, a.owner_id, a.suggested_responsible, a.timeline_note,
           a.start_date::text, a.target_date::text, a.priority::text, a.status::text, a.progress, a.category::text,
           a.business_impact, a.blocker, a.is_escalated, a.request_type, a.waiting_for, a.waiting_since, a.last_update_at, a.last_update_note, a.completed_at, a.created_at,
           ${effectiveStatusSql(today)} AS effective_status,
           d.name AS department, dir.name AS director_name, o.name AS owner_name, ab.name AS assigned_by_name,
           COALESCE((SELECT array_agg(org.code ORDER BY org.id) FROM action_organizations ao JOIN organizations org ON org.id = ao.organization_id WHERE ao.action_id = a.id), '{}') AS org_codes,
           (SELECT count(*)::int FROM action_steps s WHERE s.action_id = a.id) AS steps_total,
           (SELECT count(*)::int FROM action_steps s WHERE s.action_id = a.id AND s.status IN ('done','skipped')) AS steps_done,
           COALESCE((SELECT array_agg(s.title ORDER BY s.sequence) FROM action_steps s WHERE s.action_id = a.id AND s.status NOT IN ('done','skipped')), '{}') AS remaining_steps,
           ns.assignee_id AS ns_assignee_id, nsu.name AS ns_assignee_name, nsd.name AS ns_dept, ns.title AS ns_title, ns.status::text AS ns_status,
           COALESCE(ns.started_at, (SELECT max(ps.completed_at) FROM action_steps ps WHERE ps.action_id = a.id AND ps.sequence < ns.sequence), ns.created_at) AS ns_since,
           pa.requested_at AS pa_requested_at, apu.id AS approver_id, apu.name AS approver_name
      FROM action_plans a
      LEFT JOIN departments d ON d.id = a.department_id
      LEFT JOIN users dir ON dir.id = d.director_id
      JOIN users o ON o.id = a.owner_id
      LEFT JOIN users ab ON ab.id = a.assigned_by_id
      LEFT JOIN LATERAL (SELECT s.* FROM action_steps s WHERE s.action_id = a.id AND s.status IN ('pending','in_progress','blocked')
                         ORDER BY s.sequence LIMIT 1) ns ON TRUE
      LEFT JOIN users nsu ON nsu.id = ns.assignee_id
      LEFT JOIN departments nsd ON nsd.id = ns.department_id
      LEFT JOIN LATERAL (SELECT r.* FROM approval_records r WHERE r.action_id = a.id AND r.status = 'pending'
                         ORDER BY r.requested_at DESC LIMIT 1) pa ON TRUE
      LEFT JOIN users apu ON apu.id = COALESCE(a.assigned_by_id, dir.id)
     WHERE ${actionVisibility(u)} AND ${filterSql(f, today)}
     ORDER BY ${order}
     ${opts.limit ? sql`LIMIT ${opts.limit}` : sql``}
  `);
  const rows = (res.rows as Record<string, unknown>[]).map(toActionRow);
  const leave = await activeDelegations();
  if (leave.size) {
    for (const r of rows) {
      const d = r.waiting_on_id ? leave.get(r.waiting_on_id) : undefined;
      if (d) {
        r.acting_for = d.userName;
        r.waiting_on_id = d.delegateId;
        r.waiting_on_name = d.delegateName;
      }
    }
  }
  return rows;
}

function toActionRow(r: Record<string, unknown>): ActionRow {
  const status = r.status as string;
  const closed = status === "completed" || status === "cancelled";
  let waiting: Pick<ActionRow, "waiting_on_id" | "waiting_on_name" | "waiting_on_dept" | "waiting_on_step" | "waiting_reason" | "waiting_since"> & {
    step_blocked: boolean;
  };
  if (closed) {
    waiting = { waiting_on_id: null, waiting_on_name: null, waiting_on_dept: null, waiting_on_step: null, waiting_reason: "closed", waiting_since: null, step_blocked: false };
  } else if (status === "pending_approval") {
    waiting = {
      waiting_on_id: (r.approver_id as string) ?? null,
      waiting_on_name: (r.approver_name as string) ?? "Management approval",
      waiting_on_dept: null,
      waiting_on_step: "Completion approval",
      waiting_reason: "approval",
      waiting_since: (r.pa_requested_at as string) ?? null,
      step_blocked: false,
    };
  } else if (status === "waiting") {
    waiting = {
      waiting_on_id: null,
      waiting_on_name: (r.waiting_for as string) || "Outside party",
      waiting_on_dept: null,
      waiting_on_step: `Waiting — followed up by ${r.owner_name as string}`,
      waiting_reason: "external",
      waiting_since: (r.waiting_since as string) ?? (r.last_update_at as string) ?? null,
      step_blocked: false,
    };
  } else if (r.ns_title) {
    waiting = {
      waiting_on_id: (r.ns_assignee_id as string) ?? null,
      waiting_on_name: (r.ns_assignee_name as string) ?? "Unassigned step",
      waiting_on_dept: (r.ns_dept as string) ?? null,
      waiting_on_step: r.ns_title as string,
      waiting_reason: "step",
      waiting_since: (r.ns_since as string) ?? null,
      step_blocked: r.ns_status === "blocked",
    };
  } else {
    waiting = {
      waiting_on_id: r.owner_id as string,
      waiting_on_name: r.owner_name as string,
      waiting_on_dept: (r.department as string) ?? null,
      waiting_on_step: null,
      waiting_reason: "owner",
      waiting_since: (r.last_update_at as string) ?? (r.created_at as string),
      step_blocked: false,
    };
  }
  return {
    id: r.id as number,
    code: r.code as string,
    point_task: r.point_task as string,
    org_codes: (r.org_codes as string[]) ?? [],
    department: (r.department as string) ?? null,
    department_id: (r.department_id as number) ?? null,
    director_name: (r.director_name as string) ?? null,
    owner_id: r.owner_id as string,
    owner_name: r.owner_name as string,
    assigned_by_name: (r.assigned_by_name as string) ?? null,
    suggested_responsible: (r.suggested_responsible as string) ?? null,
    timeline_note: (r.timeline_note as string) ?? null,
    start_date: (r.start_date as string) ?? null,
    target_date: (r.target_date as string) ?? null,
    priority: r.priority as string,
    status,
    effective_status: r.effective_status as Status,
    progress: r.progress as number,
    category: (r.category as string) ?? null,
    business_impact: (r.business_impact as string) ?? null,
    request_type: (r.request_type as string) ?? null,
    waiting_for: (r.waiting_for as string) ?? null,
    blocker: (r.blocker as string) ?? null,
    is_escalated: !!r.is_escalated,
    last_update_at: (r.last_update_at as string) ?? null,
    last_update_note: (r.last_update_note as string) ?? null,
    completed_at: (r.completed_at as string) ?? null,
    created_at: r.created_at as string,
    steps_total: r.steps_total as number,
    steps_done: r.steps_done as number,
    remaining_steps: (r.remaining_steps as string[]) ?? [],
    acting_for: null,
    ...waiting,
  };
}

/** Loads the fields needed for authorization decisions on one action (only if visible). */
export async function loadActionAccess(u: CurrentUser, id: number): Promise<ActionAccessRow | null> {
  const res = await db.execute(sql`
    SELECT a.id, a.owner_id, a.assigned_by_id, a.created_by, a.department_id, a.status::text, d.director_id,
      COALESCE((SELECT array_agg(c.user_id::text) FROM action_contributors c WHERE c.action_id = a.id), '{}') AS contributor_ids,
      COALESCE((SELECT array_agg(DISTINCT s.assignee_id::text) FROM action_steps s WHERE s.action_id = a.id AND s.assignee_id IS NOT NULL), '{}') AS step_ids,
      COALESCE((SELECT array_agg(ao.organization_id) FROM action_organizations ao WHERE ao.action_id = a.id), '{}') AS org_ids
    FROM action_plans a LEFT JOIN departments d ON d.id = a.department_id
    WHERE a.id = ${id} AND ${actionVisibility(u)}`);
  const r = res.rows[0] as Record<string, unknown> | undefined;
  if (!r) return null;
  return {
    id: r.id as number,
    ownerId: r.owner_id as string,
    assignedById: (r.assigned_by_id as string) ?? null,
    createdBy: (r.created_by as string) ?? null,
    departmentId: (r.department_id as number) ?? null,
    departmentDirectorId: (r.director_id as string) ?? null,
    contributorIds: (r.contributor_ids as string[]) ?? [],
    stepAssigneeIds: (r.step_ids as string[]) ?? [],
    orgIds: (r.org_ids as number[]) ?? [],
    status: r.status as string,
  };
}

export type Lookup = {
  orgs: { id: number; code: string; name: string }[];
  departments: { id: number; name: string; organization_id: number; org_code: string; director_id: string | null; director_name: string | null }[];
  users: { id: string; name: string; email: string; role: string; department_id: number | null; department: string | null; title: string | null }[];
};

export async function lookups(): Promise<Lookup> {
  const [orgs, depts, users] = await Promise.all([
    db.execute(sql`SELECT id, code, name FROM organizations WHERE is_active ORDER BY id`),
    db.execute(sql`SELECT d.id, d.name, d.organization_id, o.code AS org_code, d.director_id, u.name AS director_name
                   FROM departments d JOIN organizations o ON o.id = d.organization_id LEFT JOIN users u ON u.id = d.director_id
                   WHERE d.is_active ORDER BY o.id, d.name`),
    db.execute(sql`SELECT u.id, u.name, u.email, u.role::text, u.department_id, d.name AS department, u.title
                   FROM users u LEFT JOIN departments d ON d.id = u.department_id WHERE u.is_active ORDER BY u.name`),
  ]);
  return { orgs: orgs.rows as Lookup["orgs"], departments: depts.rows as Lookup["departments"], users: users.rows as Lookup["users"] };
}

export type PersonOption = { id: string; name: string; detail: string };

/**
 * People the user can filter by — the level directly below them:
 * System Owner and view-all users (Abdullah Qadi) see everyone; the CEO sees company managers;
 * a company manager sees the directors of their company; a director sees their department; a manager their reports.
 * Employees get an empty list (the filter is hidden).
 */
export async function peopleOptions(u: CurrentUser): Promise<PersonOption[]> {
  let where;
  if (u.role === "system_owner" || (seesAllActions(u) && u.role !== "ceo")) {
    where = sql`u.id <> ${u.id}`;
  } else if (u.role === "ceo") {
    where = sql`u.role = 'company_manager'`;
  } else if (u.role === "company_manager") {
    const orgs = u.orgIds.length ? sql.join(u.orgIds.map((o) => sql`${o}`), sql`, `) : sql`-1`;
    where = sql`(u.id IN (SELECT director_id FROM departments WHERE organization_id IN (${orgs}) AND director_id IS NOT NULL)
                 OR (u.role = 'director' AND u.department_id IN (SELECT id FROM departments WHERE organization_id IN (${orgs}))))`;
  } else if (u.role === "director") {
    where = sql`u.id <> ${u.id} AND (u.manager_id = ${u.id} OR u.department_id = ${u.departmentId ?? -1}
                 OR u.department_id IN (SELECT id FROM departments WHERE director_id = ${u.id}))`;
  } else if (u.role === "manager") {
    where = sql`u.manager_id = ${u.id}`;
  } else {
    return [];
  }
  const r = await db.execute(sql`
    SELECT u.id, u.name, u.role::text AS role, d.name AS dept,
           (SELECT string_agg(o.code, ', ' ORDER BY o.id) FROM user_organizations uo JOIN organizations o ON o.id = uo.organization_id WHERE uo.user_id = u.id) AS orgs
      FROM users u LEFT JOIN departments d ON d.id = u.department_id
     WHERE u.is_active AND ${where} ORDER BY u.name`);
  return (r.rows as { id: string; name: string; role: string; dept: string | null; orgs: string | null }[]).map((p) => ({
    id: p.id,
    name: p.name,
    detail: p.role === "company_manager" ? `Company Manager${p.orgs ? ` · ${p.orgs}` : ""}` : (p.dept ?? ""),
  }));
}
