import { notFound } from "next/navigation";
import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireUser, isExecutive } from "@/lib/auth";
import { fmtDateTime } from "@/lib/dates";
import { EmptyState, PageHeader } from "@/components/ui";

export const metadata = { title: "Audit Log" };

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ entity?: string; q?: string; page?: string }> }) {
  const me = await requireUser();
  if (!isExecutive(me)) notFound();
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const entity = sp.entity && /^[a-z_]+$/.test(sp.entity) ? sp.entity : undefined;
  const q = sp.q?.slice(0, 80);
  const r = await db.execute(sql`SELECT l.*, u.name FROM audit_logs l LEFT JOIN users u ON u.id = l.actor_id
     WHERE TRUE ${entity ? sql`AND l.entity_type = ${entity}` : sql``} ${q ? sql`AND (l.action ILIKE ${"%" + q + "%"} OR u.name ILIKE ${"%" + q + "%"} OR l.entity_id = ${q})` : sql``}
     ORDER BY l.created_at DESC LIMIT 100 OFFSET ${(page - 1) * 100}`);
  const rows = r.rows as { id: number; name: string | null; entity_type: string; entity_id: string; action: string; changes: unknown; ip: string | null; created_at: string }[];
  const link = (e: string, id: string) => (e === "action" ? `/actions/${id}` : e === "meeting" ? `/meetings/${id}` : null);
  return (
    <>
      <PageHeader title="Audit Log" subtitle="Every significant change, with actor, time and field-level detail." />
      <form className="card no-print mb-4 flex flex-wrap items-end gap-3 p-3">
        <label><span className="label">Entity</span><select className="input" name="entity" defaultValue={entity ?? ""}><option value="">All</option>{["action", "action_step", "approval", "meeting", "objective", "objective_item", "user", "department", "auth", "report", "settings"].map((e) => <option key={e} value={e}>{e.replace("_", " ")}</option>)}</select></label>
        <label><span className="label">Search</span><input className="input" name="q" defaultValue={q} placeholder="Action, person or record ID" /></label>
        <button className="btn btn-primary">Apply</button>
      </form>
      {rows.length === 0 ? <EmptyState title="No audit entries." /> : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead><tr><th>Time</th><th>Actor</th><th>Entity</th><th>Action</th><th>Details</th><th>IP</th></tr></thead>
            <tbody>{rows.map((x) => {
              const href = link(x.entity_type, x.entity_id);
              return (
                <tr key={x.id}>
                  <td className="whitespace-nowrap text-xs">{fmtDateTime(x.created_at)}</td>
                  <td>{x.name ?? <span className="text-muted">System</span>}</td>
                  <td className="text-xs">{x.entity_type} {href ? <Link className="link" href={href}>#{x.entity_id}</Link> : <span className="text-muted">#{x.entity_id.slice(0, 12)}</span>}</td>
                  <td>{x.action.replace(/_/g, " ")}</td>
                  <td className="max-w-md"><code className="line-clamp-3 break-all text-[11px] text-muted">{x.changes ? JSON.stringify(x.changes) : ""}</code></td>
                  <td className="text-xs text-muted">{x.ip ?? ""}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      )}
      <div className="mt-4 flex gap-2">
        {page > 1 && <Link className="btn btn-secondary btn-sm" href={`?${new URLSearchParams({ ...(entity ? { entity } : {}), ...(q ? { q } : {}), page: String(page - 1) })}`}>Newer</Link>}
        {rows.length === 100 && <Link className="btn btn-secondary btn-sm" href={`?${new URLSearchParams({ ...(entity ? { entity } : {}), ...(q ? { q } : {}), page: String(page + 1) })}`}>Older</Link>}
      </div>
    </>
  );
}
