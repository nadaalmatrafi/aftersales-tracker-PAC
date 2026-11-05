import type { ActionFilters, Lookup } from "@/lib/queries";
import { PRIORITIES, PRIORITY_LABEL, STATUSES, STATUS_LABEL } from "@/lib/constants";

/** Plain GET form — works without JavaScript and keeps filters shareable via URL. */
export function FilterBar({
  f,
  lk,
  meetings,
  action,
  extra,
  showSearch = true,
}: {
  f: ActionFilters;
  lk: Lookup;
  meetings?: { id: string; title: string; date: string }[];
  action: string;
  extra?: React.ReactNode;
  showSearch?: boolean;
}) {
  const directors = lk.departments
    .filter((d) => d.director_id)
    .reduce<Map<string, string>>((m, d) => m.set(d.director_id!, d.director_name!), new Map());
  const active = [f.q, f.org, f.dept, f.director, f.owner, f.status, f.priority, f.meeting, f.from, f.to].filter(Boolean).length;
  return (
    <details className="card no-print group mb-4" open={active > 0 || undefined}>
      <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2.5 text-sm">
        <span className="font-medium">Filters{active ? <span className="ml-2 rounded bg-accent px-1.5 text-[11px] text-white">{active} active</span> : <span className="ml-2 text-xs text-muted">Organization, department, director, status, period…</span>}</span>
        <span className="text-xs text-muted group-open:hidden">Show</span><span className="hidden text-xs text-muted group-open:inline">Hide</span>
      </summary>
    <form method="get" action={action} className="grid grid-cols-2 gap-3 border-t border-line p-3 sm:grid-cols-3 lg:grid-cols-6 xl:grid-cols-9">
      {showSearch && (
        <label className="col-span-2 sm:col-span-3 lg:col-span-2 xl:col-span-2">
          <span className="label">Search</span>
          <input className="input" name="q" defaultValue={f.q} placeholder="Code or text" />
        </label>
      )}
      <label>
        <span className="label">Organization</span>
        <select className="input" name="org" defaultValue={f.org ?? ""}>
          <option value="">All</option>
          {lk.orgs.map((o) => (
            <option key={o.id} value={o.id}>{o.code}</option>
          ))}
        </select>
      </label>
      <label>
        <span className="label">Department</span>
        <select className="input" name="dept" defaultValue={f.dept ?? ""}>
          <option value="">All</option>
          {lk.departments.map((d) => (
            <option key={d.id} value={d.id}>{d.org_code} · {d.name}</option>
          ))}
        </select>
      </label>
      <label>
        <span className="label">Director</span>
        <select className="input" name="director" defaultValue={f.director ?? ""}>
          <option value="">All</option>
          {[...directors].map(([id, name]) => (
            <option key={id} value={id}>{name}</option>
          ))}
        </select>
      </label>
      <label>
        <span className="label">Responsible</span>
        <select className="input" name="owner" defaultValue={f.owner ?? ""}>
          <option value="">All</option>
          {lk.users.map((u) => (
            <option key={u.id} value={u.id}>{u.name}</option>
          ))}
        </select>
      </label>
      <label>
        <span className="label">Status</span>
        <select className="input" name="status" defaultValue={f.status ?? ""}>
          <option value="">All</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{STATUS_LABEL[s]}</option>
          ))}
        </select>
      </label>
      <label>
        <span className="label">Priority</span>
        <select className="input" name="priority" defaultValue={f.priority ?? ""}>
          <option value="">All</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
          ))}
        </select>
      </label>
      {meetings && (
        <label>
          <span className="label">Meeting</span>
          <select className="input" name="meeting" defaultValue={f.meeting ?? ""}>
            <option value="">All</option>
            {meetings.map((m) => (
              <option key={m.id} value={m.id}>{m.date} · {m.title}</option>
            ))}
          </select>
        </label>
      )}
      <label>
        <span className="label">Period from</span>
        <input className="input" type="date" name="from" defaultValue={f.from} />
      </label>
      <label>
        <span className="label">Period to</span>
        <input className="input" type="date" name="to" defaultValue={f.to} />
      </label>
      {extra}
      <div className="col-span-2 flex items-end gap-2 sm:col-span-1">
        <button className="btn btn-primary">Apply</button>
        <a href={action} className="btn btn-ghost">Reset</a>
      </div>
    </form>
    </details>
  );
}
