import Link from "next/link";
import { FileDown } from "lucide-react";
import { requireUser, canExport, seesAllActions } from "@/lib/auth";
import { listActions, lookups, parseFilters, peopleOptions } from "@/lib/queries";
import { holders, impactSummary, kpis, monthlyTrend, objectiveProgress, overdueAging, statusBreakdown } from "@/lib/dashboard";
import { fmtRelative, todayISO, fmtDate } from "@/lib/dates";
import { ActionTable } from "@/components/action-table";
import { FilterBar, peopleLabelFor, toQuery } from "@/components/filter-bar";
import { ObjectivesCard, ObjectivesPanel } from "@/components/objectives-panel";
import { KpiCard, PageHeader, Section, EmptyState } from "@/components/ui";
import { SingleBars, StatusStack, TrendChart } from "@/components/charts";

export const metadata = { title: "Overview" };

const sar = (n: number) => (n ? `SAR ${Math.round(n).toLocaleString("en-US")}` : "—");

export default async function Overview({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const u = await requireUser();
  const sp = await searchParams;
  const f = parseFilters(sp);
  const [rows, lk, peopleOpts, impact, objectives] = await Promise.all([listActions(u, f), lookups(), peopleOptions(u), impactSummary(u, f), objectiveProgress(u, f.org)]);
  const obj = typeof sp.obj === "string" && ["30", "60", "90"].includes(sp.obj) ? sp.obj : null;
  const here = (extra: Record<string, string | null>) => {
    const q = toQuery(sp, {}, Object.keys(extra).concat()).toString();
    const p = new URLSearchParams(q);
    for (const [a, b] of Object.entries(extra)) if (b != null) p.set(a, b);
    const qs2 = p.toString();
    return `/overview${qs2 ? `?${qs2}` : ""}`;
  };
  const filterQs = toQuery(sp, {}, ["obj"]);
  const k = kpis(rows, lk.orgs);
  const qs = (extra: Record<string, string>) => `/actions?${toQuery(sp, extra, ["obj"])}`;
  const open = rows.filter((a) => a.status !== "completed" && a.status !== "cancelled");
  const attention = open.filter((a) => a.effective_status === "overdue" || a.is_escalated || a.step_blocked || a.priority === "critical").slice(0, 12);
  const people = holders(rows).slice(0, 10);
  const byOrg = statusBreakdown(rows, (a) => a.org_codes);
  const byDirector = statusBreakdown(rows, (a) => a.director_name, "No director assigned");
  const byDept = statusBreakdown(rows, (a) => a.department, "Department not assigned");
  const aging = overdueAging(rows);

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle={<>Live figures from action plan records · {fmtDate(todayISO())} · {u.name}</>}
        actions={
          <>
            {canExport(u) && <a className="btn btn-primary" href={`/api/reports/ceo-summary?format=pdf${filterQs ? `&${filterQs}` : ""}`}><FileDown size={15} aria-hidden /> One-page PDF</a>}
            <Link href="/reports" className="btn btn-secondary">Reports</Link>
          </>
        }
      />
      <FilterBar f={f} lk={lk} people={peopleOpts} peopleLabel={peopleLabelFor(u.role, u.role === "system_owner" || (seesAllActions(u) && u.role !== "ceo"))} action="/overview" />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <KpiCard label="Total action plans" value={k.total} href={qs({})} />
        <KpiCard label="Active" value={k.active} tone="info" href={qs({})} />
        <KpiCard label="Completed" value={k.completed} tone="ok" href={qs({ status: "completed" })} />
        <KpiCard label="Overdue" value={k.overdue} tone="danger" href={qs({ status: "overdue" })} />
        <KpiCard label="Critical issues" value={k.critical} tone="danger" hint="Critical priority or escalated" href={qs({ escalated: "1" })} />
        <KpiCard label="Completion rate" value={k.completionRate == null ? "—" : `${k.completionRate}%`} hint="Completed ÷ non-cancelled" />
        <KpiCard label="Due in 7 days" value={k.upcoming} tone="warn" href={qs({ dueSoon: "1" })} />
        <KpiCard label="No update 7+ days" value={k.stale} tone="neutral" href={qs({ stale: "1" })} hint={k.noTargetDate ? `${k.noTargetDate} open without target date` : undefined} />
        <KpiCard label="By organization" value={<span className="flex flex-wrap gap-x-3 text-base">{k.byOrg.map((o) => <span key={o.code}><span className="text-xs text-muted">{o.code}</span> {o.n}</span>)}</span>} />
      </div>

      <div className="mt-5">
        <ObjectivesCard progress={objectives} href={(h) => `${here({ obj: h })}#objectives`} />
      </div>
      {obj && (
        <div className="mt-5">
          <ObjectivesPanel u={u} horizon={obj} lk={lk} closeHref={here({ obj: null })} tabHref={(h) => `${here({ obj: h })}#objectives`} />
        </div>
      )}

      <div className="mt-5 grid gap-5">
        <Section title="Requires attention — where each item stands" actions={<Link className="text-xs text-muted hover:text-fg" href={qs({})}>All actions →</Link>}>
          <div className="-m-4">
            <ActionTable rows={attention} emptyText="Nothing overdue, blocked or escalated." />
          </div>
        </Section>
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Section title="Who is holding open work — current bottlenecks">
          {people.length === 0 ? (
            <EmptyState title="No open actions." />
          ) : (
            <div className="-m-4 overflow-x-auto"><table className="table">
              <thead><tr><th>Person</th><th className="text-right">Open</th><th className="text-right">Overdue</th><th>Oldest</th></tr></thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.name}>
                    <td><div className="font-medium">{p.name}{p.actingFor ? <span className="ml-1 text-[11px] font-normal text-orange">covering for {p.actingFor}</span> : null}</div><div className="text-[11px] text-muted">{p.dept ?? ""}{p.blocked ? `${p.dept ? " · " : ""}${p.blocked} blocked` : ""}</div></td>
                    <td className="text-right tabular-nums">{p.open}</td>
                    <td className={`text-right tabular-nums ${p.overdue ? "text-accent" : "text-muted"}`}>{p.overdue}</td>
                    <td className="text-xs text-muted">{fmtRelative(p.oldest)}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </Section>
        <Section title="Monthly trend — created vs. completed">
          <TrendChart data={monthlyTrend(rows)} />
        </Section>
        <Section title="Performance by organization">
          {byOrg.length ? <StatusStack data={byOrg} /> : <EmptyState title="No data for the selected filters." />}
        </Section>
        <Section title="Performance by director">
          {byDirector.length ? <StatusStack data={byDirector} /> : <EmptyState title="No data." />}
        </Section>
        <Section title="Department progress — average completion">
          {byDept.length ? <SingleBars data={byDept.map((d) => ({ name: d.name, avgProgress: d.avgProgress }))} dataKey="avgProgress" name="Average progress" suffix="%" max={100} color="#171614" /> : <EmptyState title="No data." />}
        </Section>
        <Section title="Overdue analysis — days past target">
          {k.overdue ? <SingleBars data={aging.map((a) => ({ name: a.bucket, count: a.count }))} dataKey="count" name="Overdue actions" color="#ce102c" /> : <EmptyState title="No overdue actions.">{k.noTargetDate ? `${k.noTargetDate} open action(s) have no target date and cannot become overdue — set dates to track them.` : null}</EmptyState>}
        </Section>
      </div>

      <Section title="Business impact summary" className="mt-5">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <KpiCard label="Expected revenue" value={sar(impact.expected_revenue)} />
          <KpiCard label="Confirmed revenue" value={sar(impact.actual_revenue)} tone="ok" />
          <KpiCard label="Expected savings" value={sar(impact.expected_savings)} />
          <KpiCard label="Confirmed savings" value={sar(impact.actual_savings)} tone="ok" />
          <KpiCard label="Estimated cost" value={sar(impact.estimated_cost)} />
          <KpiCard label="Confirmed cost" value={sar(impact.actual_cost)} />
        </div>
        <p className="mt-3 text-xs text-muted">
          {impact.with_expected} action(s) with expected impact · {impact.confirmed} with confirmed actuals
          {impact.unconfirmed ? ` · ${impact.unconfirmed} with actuals awaiting confirmation (excluded above)` : ""}. Only management-confirmed actual results are counted.
        </p>
      </Section>
    </>
  );
}
