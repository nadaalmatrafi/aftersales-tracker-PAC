import Link from "next/link";
import { requireUser, canExport, seesAllActions } from "@/lib/auth";
import { lookups, parseFilters, peopleOptions } from "@/lib/queries";
import { buildReport, REPORTS, type ReportType } from "@/lib/reports";
import { FilterBar, peopleLabelFor } from "@/components/filter-bar";
import { EmptyState, PageHeader, cx } from "@/components/ui";

export const metadata = { title: "Reports" };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const u = await requireUser();
  const sp = await searchParams;
  const type = (typeof sp.type === "string" && sp.type in REPORTS ? sp.type : "executive") as ReportType;
  const f = parseFilters(sp);
  const [lk, people, report] = await Promise.all([lookups(), peopleOptions(u), buildReport(u, type, f)]);
  const qs = new URLSearchParams(Object.entries(sp).filter(([k, v]) => typeof v === "string" && v && k !== "type") as [string, string][]).toString();
  const exportAllowed = canExport(u);
  return (
    <>
      <PageHeader
        title="Reports"
        subtitle="Exports apply the selected filters and your access permissions."
        actions={exportAllowed ? (
          <>
            <a className="btn btn-secondary" href={`/api/reports/${type}?format=xlsx&${qs}`}>Export Excel</a>
            <a className="btn btn-primary" href={`/api/reports/${type}?format=pdf&${qs}`}>Export PDF</a>
          </>
        ) : <span className="text-xs text-muted">Export is not enabled for your role.</span>}
      />
      <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
        <nav aria-label="Report types" className="card h-fit p-2">
          <ul className="space-y-0.5">
            {(Object.keys(REPORTS) as ReportType[]).map((k, i) => (
              <li key={k}>
                <Link href={`/reports?type=${k}${qs ? `&${qs}` : ""}`} aria-current={k === type ? "page" : undefined}
                  className={cx("block rounded-md px-3 py-2 text-[13px]", k === type ? "bg-surface-3 text-fg" : "text-fg-2 hover:bg-surface-2")}>
                  <span className="mr-1.5 text-xs tabular-nums text-muted">{i + 1}.</span>{REPORTS[k].title.replace(" Report", "")}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0">
          <FilterBar f={f} lk={lk} people={people} peopleLabel={peopleLabelFor(u.role, u.role === "system_owner" || (seesAllActions(u) && u.role !== "ceo"))} action="/reports" extra={<input type="hidden" name="type" value={type} />} />
          <div className="card">
            <header className="border-b border-line p-4">
              <h2 className="font-semibold">{report.title}</h2>
              <p className="text-xs text-muted">{REPORTS[type].desc} · {report.rows.length} row(s)</p>
            </header>
            {report.rows.length === 0 ? <div className="p-4"><EmptyState title="No records match the selected filters." /></div> : (
              <div className="max-h-[70vh] overflow-auto">
                <table className="table">
                  <thead><tr>{report.columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
                  <tbody>{report.rows.map((r, i) => <tr key={i}>{report.columns.map((c) => <td key={c.key} className={c.key === "task" || c.key === "item" || c.key === "deliverable" ? "min-w-72" : ""}>{String(r[c.key] ?? "")}</td>)}</tr>)}</tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
