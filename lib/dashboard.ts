import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { CurrentUser } from "./auth";
import { actionVisibility } from "./access";
import { filterSql, type ActionFilters, type ActionRow } from "./queries";
import { addDaysISO, daysBetween, todayISO } from "./dates";
import { DEADLINE_SOON_DAYS, STALE_UPDATE_DAYS } from "./constants";
import { objectiveVisibility } from "./objectives";

const isOpen = (a: ActionRow) => a.status !== "completed" && a.status !== "cancelled";

export function kpis(rows: ActionRow[], orgs: { code: string }[]) {
  const today = todayISO();
  const soon = addDaysISO(today, DEADLINE_SOON_DAYS);
  const staleCutoff = Date.now() - STALE_UPDATE_DAYS * 86_400_000;
  const total = rows.length;
  const cancelled = rows.filter((a) => a.status === "cancelled").length;
  const completed = rows.filter((a) => a.status === "completed").length;
  const open = rows.filter(isOpen);
  const byOrg = orgs.map((o) => ({ code: o.code, n: rows.filter((a) => a.org_codes.includes(o.code)).length }));
  return {
    total,
    active: open.length,
    completed,
    overdue: rows.filter((a) => a.effective_status === "overdue").length,
    pendingApproval: rows.filter((a) => a.status === "pending_approval").length,
    critical: open.filter((a) => a.priority === "critical" || a.is_escalated).length,
    completionRate: total - cancelled > 0 ? Math.round((completed / (total - cancelled)) * 100) : null,
    upcoming: open.filter((a) => a.target_date && a.target_date >= today && a.target_date <= soon).length,
    stale: open.filter((a) => new Date(a.last_update_at ?? a.created_at).getTime() < staleCutoff).length,
    noTargetDate: open.filter((a) => !a.target_date).length,
    byOrg,
  };
}

/** Last 12 months: actions created vs. completed per month (Riyadh calendar). */
export function monthlyTrend(rows: ActionRow[]) {
  const months: string[] = [];
  const t = todayISO();
  let y = Number(t.slice(0, 4)),
    m = Number(t.slice(5, 7));
  for (let i = 0; i < 12; i++) {
    months.unshift(`${y}-${String(m).padStart(2, "0")}`);
    m--;
    if (m === 0) {
      m = 12;
      y--;
    }
  }
  const key = (v: string) => new Date(new Date(v).getTime() + 3 * 3_600_000).toISOString().slice(0, 7);
  return months.map((mo) => ({
    month: new Date(`${mo}-01T00:00:00Z`).toLocaleString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" }),
    created: rows.filter((a) => key(a.created_at) === mo).length,
    completed: rows.filter((a) => a.completed_at && key(a.completed_at) === mo).length,
  }));
}

export function statusBreakdown(rows: ActionRow[], keyOf: (a: ActionRow) => string[] | string | null, fallback = "Unassigned") {
  const map = new Map<string, { name: string; completed: number; onTrack: number; overdue: number; total: number; progressSum: number }>();
  for (const a of rows) {
    if (a.status === "cancelled") continue;
    const raw = keyOf(a);
    const keys = Array.isArray(raw) ? (raw.length ? raw : [fallback]) : [raw ?? fallback];
    for (const k of keys) {
      const e = map.get(k) ?? { name: k, completed: 0, onTrack: 0, overdue: 0, total: 0, progressSum: 0 };
      e.total++;
      e.progressSum += a.progress;
      if (a.status === "completed") e.completed++;
      else if (a.effective_status === "overdue") e.overdue++;
      else e.onTrack++;
      map.set(k, e);
    }
  }
  return [...map.values()]
    .map((e) => ({ ...e, avgProgress: e.total ? Math.round(e.progressSum / e.total) : 0, completionRate: e.total ? Math.round((e.completed / e.total) * 100) : 0 }))
    .sort((a, b) => b.total - a.total);
}

export function overdueAging(rows: ActionRow[]) {
  const today = todayISO();
  const buckets = [
    { bucket: "1–7 days", min: 1, max: 7, count: 0 },
    { bucket: "8–30 days", min: 8, max: 30, count: 0 },
    { bucket: "31–60 days", min: 31, max: 60, count: 0 },
    { bucket: "60+ days", min: 61, max: Infinity, count: 0 },
  ];
  for (const a of rows) {
    if (a.effective_status !== "overdue" || !a.target_date) continue;
    const d = daysBetween(a.target_date, today);
    const b = buckets.find((x) => d >= x.min && d <= x.max);
    if (b) b.count++;
  }
  return buckets.map(({ bucket, count }) => ({ bucket, count }));
}

/** Who currently holds open work — the bottleneck view. */
export function holders(rows: ActionRow[]) {
  const map = new Map<string, { name: string; dept: string | null; actingFor: string | null; open: number; overdue: number; blocked: number; approvals: number; oldest: string | null }>();
  for (const a of rows) {
    if (!isOpen(a) || !a.waiting_on_name) continue;
    const k = a.waiting_on_id ?? a.waiting_on_name;
    const e = map.get(k) ?? { name: a.waiting_on_name, dept: a.acting_for ? null : a.waiting_on_dept, actingFor: a.acting_for, open: 0, overdue: 0, blocked: 0, approvals: 0, oldest: null };
    e.open++;
    if (a.effective_status === "overdue") e.overdue++;
    if (a.step_blocked) e.blocked++;
    if (a.waiting_reason === "approval") e.approvals++;
    if (a.waiting_since && (!e.oldest || a.waiting_since < e.oldest)) e.oldest = a.waiting_since;
    map.set(k, e);
  }
  return [...map.values()].sort((a, b) => b.overdue - a.overdue || b.open - a.open);
}

export async function impactSummary(u: CurrentUser, f: ActionFilters) {
  const today = todayISO();
  const r = await db.execute(sql`
    SELECT COALESCE(sum(i.expected_revenue),0)::float AS expected_revenue,
           COALESCE(sum(i.actual_revenue) FILTER (WHERE i.actuals_confirmed_at IS NOT NULL),0)::float AS actual_revenue,
           COALESCE(sum(i.expected_savings),0)::float AS expected_savings,
           COALESCE(sum(i.actual_savings) FILTER (WHERE i.actuals_confirmed_at IS NOT NULL),0)::float AS actual_savings,
           COALESCE(sum(i.estimated_cost),0)::float AS estimated_cost,
           COALESCE(sum(i.actual_cost) FILTER (WHERE i.actuals_confirmed_at IS NOT NULL),0)::float AS actual_cost,
           count(*) FILTER (WHERE i.expected_revenue IS NOT NULL OR i.expected_savings IS NOT NULL)::int AS with_expected,
           count(*) FILTER (WHERE i.actuals_confirmed_at IS NOT NULL)::int AS confirmed,
           count(*) FILTER (WHERE i.actuals_confirmed_at IS NULL AND (i.actual_revenue IS NOT NULL OR i.actual_savings IS NOT NULL))::int AS unconfirmed
      FROM impact_records i JOIN action_plans a ON a.id = i.action_id
     WHERE ${actionVisibility(u)} AND ${filterSql(f, today)} AND a.status <> 'cancelled'`);
  return r.rows[0] as {
    expected_revenue: number;
    actual_revenue: number;
    expected_savings: number;
    actual_savings: number;
    estimated_cost: number;
    actual_cost: number;
    with_expected: number;
    confirmed: number;
    unconfirmed: number;
  };
}

export async function objectiveProgress(u: CurrentUser, org?: number) {
  const r = await db.execute(sql`
    SELECT o.horizon::text AS horizon, count(DISTINCT o.id)::int AS objectives, count(i.id)::int AS items,
           count(i.id) FILTER (WHERE i.approval_status = 'approved')::int AS done,
           count(i.id) FILTER (WHERE i.approval_status = 'approved')::int AS approved
      FROM objectives o LEFT JOIN objective_items i ON i.objective_id = o.id
     WHERE o.archived_at IS NULL AND ${objectiveVisibility(u)} ${org ? sql`AND (o.organization_id = ${org} OR o.organization_id IS NULL)` : sql``}
     GROUP BY o.horizon ORDER BY o.horizon::text::int`);
  const rows = r.rows as { horizon: string; objectives: number; items: number; done: number; approved: number }[];
  return ["30", "60", "90"].map((h) => {
    const x = rows.find((y) => y.horizon === h);
    return { horizon: `${h}-day`, objectives: x?.objectives ?? 0, items: x?.items ?? 0, done: x?.done ?? 0, pct: x && x.items ? Math.round((x.done / x.items) * 100) : 0 };
  });
}
