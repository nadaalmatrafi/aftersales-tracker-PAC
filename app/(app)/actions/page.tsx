import Link from "next/link";
import { Plus } from "lucide-react";
import { requireUser, canCreateActions, canExport, seesAllActions } from "@/lib/auth";
import { listActions, lookups, parseFilters, peopleOptions } from "@/lib/queries";
import { ActionTable } from "@/components/action-table";
import { FilterBar, peopleLabelFor, toQuery } from "@/components/filter-bar";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Action Plans" };

export default async function ActionsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const u = await requireUser();
  const sp = await searchParams;
  const f = parseFilters(sp);
  delete f.q; // search was replaced by the Status / Company / People filters
  const [rows, lk, people] = await Promise.all([listActions(u, f), lookups(), peopleOptions(u)]);
  const qs = toQuery(sp, {}, ["q", "deleted"]);
  return (
    <>
      <PageHeader
        title="Action Plans"
        subtitle={`${rows.length} action plan${rows.length === 1 ? "" : "s"} · ownership, current hand-off position and progress`}
        actions={
          <>
            {canExport(u) && (
              <>
                <a className="btn btn-secondary" href={`/api/reports/executive?format=xlsx&${qs}`}>Excel</a>
                <a className="btn btn-secondary" href={`/api/reports/executive?format=pdf&${qs}`}>PDF</a>
              </>
            )}
            {canCreateActions(u) && (
              <Link href="/actions/new" className="btn btn-primary"><Plus size={15} aria-hidden /> New action</Link>
            )}
          </>
        }
      />
      {sp.deleted && <p role="status" className="mb-4 text-sm text-ok">Action plan deleted. It remains recoverable by the System Owner.</p>}
      <FilterBar variant="actions" f={f} lk={lk} people={people} peopleLabel={peopleLabelFor(u.role, u.role === "system_owner" || (seesAllActions(u) && u.role !== "ceo"))} action="/actions" />
      <div className="card">
        <ActionTable rows={rows} />
      </div>
    </>
  );
}
