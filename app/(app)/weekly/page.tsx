import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireUser, seesAllActions } from "@/lib/auth";
import { actionVisibility } from "@/lib/access";
import { listActions, lookups, parseFilters, peopleOptions } from "@/lib/queries";
import { addDaysISO, fmtDate, fmtDateTime, todayISO } from "@/lib/dates";
import { ActionTable } from "@/components/action-table";
import { ActiveFilters, FilterBar, peopleLabelFor } from "@/components/filter-bar";
import { EmptyState, KpiCard, PageHeader, Section } from "@/components/ui";

export const metadata = { title: "Weekly review" };

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** What moved in a 7-day window: new requests, completions, updates posted, and what is stuck. */
export default async function WeeklyReview({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const u = await requireUser();
  const sp = await searchParams;
  const endRaw = typeof sp.week === "string" && ISO.test(sp.week) ? sp.week : todayISO();
  const end = endRaw > todayISO() ? todayISO() : endRaw;
  const start = addDaysISO(end, -6);
  const f = parseFilters(sp);
  delete f.from;
  delete f.to;
  const [rows, lk, people] = await Promise.all([listActions(u, f), lookups(), peopleOptions(u)]);
  const ids = rows.map((r) => r.id);
  const inWeek = (v: string | null) => !!v && v.slice(0, 10) >= start && v.slice(0, 10) <= end;
  // created_at / completed_at are timestamps; compare on the business-day date.
  const day = (v: string | null) => (v ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date(v)) : null);
  const created = rows.filter((r) => inWeek(day(r.created_at)));
  const completed = rows.filter((r) => r.status === "completed" && inWeek(day(r.completed_at)));
  const open = rows.filter((r) => r.status !== "completed" && r.status !== "cancelled");
  const overdue = open.filter((r) => r.effective_status === "overdue");
  const waiting = open.filter((r) => r.status === "waiting");
  const silent = open.filter((r) => !inWeek(day(r.last_update_at)));

  const updates = ids.length
    ? ((
        await db.execute(sql`
          SELECT up.id, up.note, up.created_at, up.status::text AS status, up.progress, us.name AS by_name, a.id AS action_id, a.code, a.point_task
            FROM action_updates up JOIN action_plans a ON a.id = up.action_id JOIN users us ON us.id = up.user_id
           WHERE ${actionVisibility(u)} AND a.id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})
             AND (up.created_at AT TIME ZONE 'Asia/Riyadh')::date BETWEEN ${start}::date AND ${end}::date
           ORDER BY up.created_at DESC LIMIT 200`)
      ).rows as { id: number; note: string; created_at: string; by_name: string; action_id: number; code: string; point_task: string }[])
    : [];

  const prev = addDaysISO(end, -7);
  const next = addDaysISO(end, 7);
  const weekLink = (w: string) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (k !== "week" && v) for (const x of Array.isArray(v) ? v : [v]) p.append(k, x);
    p.set("week", w);
    return `/weekly?${p.toString()}`;
  };
  const spNoWeek = Object.fromEntries(Object.entries(sp).filter(([k]) => k !== "week"));

  return (
    <>
      <PageHeader
        title="Weekly review"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link className="btn btn-secondary btn-sm" href={weekLink(prev)}>← Previous week</Link>
            <span className="text-sm font-medium tabular-nums text-fg-2">{fmtDate(start)} – {fmtDate(end)}</span>
            {end < todayISO() && <Link className="btn btn-secondary btn-sm" href={weekLink(next > todayISO() ? todayISO() : next)}>Next week →</Link>}
          </div>
        }
      />
      <FilterBar variant="actions" f={f} lk={lk} people={people} peopleLabel={peopleLabelFor(u.role, u.role === "system_owner" || (seesAllActions(u) && u.role !== "ceo"))} action="/weekly" extra={<input type="hidden" name="week" value={end} />} />
      <ActiveFilters sp={spNoWeek} f={f} lk={lk} people={people} action="/weekly" count={rows.length} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard label="New requests" value={created.length} tone="info" />
        <KpiCard label="Completed" value={completed.length} tone="ok" />
        <KpiCard label="Updates posted" value={updates.length} />
        <KpiCard label="Overdue now" value={overdue.length} tone="danger" />
        <KpiCard label="Waiting (outside)" value={waiting.length} tone="warn" />
        <KpiCard label="No update this week" value={silent.length} tone="neutral" hint="Open actions" />
      </div>

      <div className="mt-5 grid gap-5">
        <Section title={`Stuck — overdue or no update this week (${new Set([...overdue, ...silent].map((r) => r.id)).size})`}>
          <div className="-m-4"><ActionTable rows={open.filter((r) => r.effective_status === "overdue" || !inWeek(day(r.last_update_at)))} emptyText="Every open action was updated this week and nothing is overdue." /></div>
        </Section>
        <Section title={`Waiting on something outside this system (${waiting.length})`}>
          <div className="-m-4"><ActionTable compact rows={waiting} emptyText="Nothing is waiting on an outside party." /></div>
        </Section>
        <div className="grid gap-5 lg:grid-cols-2">
          <Section title={`New requests this week (${created.length})`}>
            <div className="-m-4"><ActionTable compact rows={created} emptyText="No new requests this week." /></div>
          </Section>
          <Section title={`Completed this week (${completed.length})`}>
            <div className="-m-4"><ActionTable compact rows={completed} emptyText="Nothing was completed this week." /></div>
          </Section>
        </div>
        <Section title={`Updates posted (${updates.length})`}>
          {updates.length === 0 ? (
            <EmptyState title="No updates were posted this week." />
          ) : (
            <ol className="divide-y divide-line">
              {updates.map((x) => (
                <li key={x.id} className="py-2 text-sm">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <Link href={`/actions/${x.action_id}`} className="link font-medium">{x.code}</Link>
                    <span className="line-clamp-1 min-w-0 flex-1 text-fg-2">{x.point_task}</span>
                    <span className="text-xs text-muted">{fmtDateTime(x.created_at)}</span>
                  </div>
                  <p className="mt-0.5 text-fg">{x.note} <span className="text-xs text-muted">— {x.by_name}</span></p>
                </li>
              ))}
            </ol>
          )}
        </Section>
      </div>
    </>
  );
}
