import type { ActionFilters, Lookup, PersonOption } from "@/lib/queries";
import { ChevronDown } from "lucide-react";
import { FILTER_STATUSES, PRIORITIES, PRIORITY_LABEL, STATUS_LABEL } from "@/lib/constants";

/**
 * Plain GET form — works without JavaScript and keeps filters shareable via URL.
 * "actions": Status, Company and the hierarchy People filter (hidden when the user has nobody below them).
 * "full": adds priority and reporting period, collapsible (Overview, Reports).
 */
export function FilterBar({
  f,
  lk,
  people,
  peopleLabel = "People",
  action,
  extra,
  variant = "full",
}: {
  f: ActionFilters;
  lk: Lookup;
  people: PersonOption[];
  peopleLabel?: string;
  action: string;
  extra?: React.ReactNode;
  variant?: "actions" | "full";
}) {
  const fields = (
    <>
      <StatusMulti selected={f.statuses ?? []} />
      <label>
        <span className="label">Company</span>
        <select className="input" name="org" defaultValue={f.org ?? ""}>
          <option value="">All</option>
          {lk.orgs.map((o) => (
            <option key={o.id} value={o.id}>{o.code} · {o.name}</option>
          ))}
        </select>
      </label>
      {people.length > 0 && (
        <label>
          <span className="label">{peopleLabel}</span>
          <select className="input" name="person" defaultValue={f.person ?? ""}>
            <option value="">All</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>{p.name}{p.detail ? ` · ${p.detail}` : ""}</option>
            ))}
          </select>
        </label>
      )}
    </>
  );
  const buttons = (
    <div className="flex items-end gap-2">
      <button className="btn btn-primary">Apply</button>
      <a href={action} className="btn btn-ghost">Reset</a>
    </div>
  );

  if (variant === "actions") {
    return (
      <form method="get" action={action} className="card no-print mb-4 grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 lg:grid-cols-[repeat(3,minmax(0,1fr))_auto]">
        {fields}
        {extra}
        {buttons}
      </form>
    );
  }

  const active = [f.org, f.person, f.statuses?.length, f.priority, f.from, f.to].filter(Boolean).length;
  return (
    <details className="card no-print group mb-4" open={active > 0 || undefined}>
      <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2.5 text-sm">
        <span className="font-medium">
          Filters
          {active ? <span className="ml-2 rounded bg-accent px-1.5 text-[11px] text-white">{active} active</span> : <span className="ml-2 text-xs text-muted">Status, company, people, priority, period</span>}
        </span>
        <span className="text-xs text-muted group-open:hidden">Show</span>
        <span className="hidden text-xs text-muted group-open:inline">Hide</span>
      </summary>
      <form method="get" action={action} className="grid grid-cols-2 gap-3 border-t border-line p-3 sm:grid-cols-3 lg:grid-cols-7">
        {fields}
        <label>
          <span className="label">Priority</span>
          <select className="input" name="priority" defaultValue={f.priority ?? ""}>
            <option value="">All</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="label">Period from</span>
          <input className="input" type="date" name="from" defaultValue={f.from} />
        </label>
        <label>
          <span className="label">Period to</span>
          <input className="input" type="date" name="to" defaultValue={f.to} />
        </label>
        {extra}
        <div className="col-span-2 sm:col-span-1">{buttons}</div>
      </form>
    </details>
  );
}

/** Label for the hierarchy filter, named after the level the user sees. */
export function peopleLabelFor(role: string, seesEveryone: boolean) {
  if (seesEveryone) return "People";
  if (role === "ceo") return "Company managers";
  if (role === "company_manager") return "Department directors";
  return "Team members";
}

/** Multi-select status filter: checkboxes in a dropdown; works without JavaScript (all checked boxes are submitted). */
function StatusMulti({ selected }: { selected: string[] }) {
  const summary = selected.length === 0 ? "All" : selected.map((s) => STATUS_LABEL[s as keyof typeof STATUS_LABEL]).join(", ");
  return (
    <div className="min-w-0">
      <span className="label">Status</span>
      <details className="group/status relative">
        <summary className="input flex cursor-pointer list-none items-center justify-between gap-2" aria-label="Status (select one or more)">
          <span className="truncate">{summary}</span>
          <ChevronDown size={14} className="shrink-0 text-muted" aria-hidden />
        </summary>
        <div className="absolute z-20 mt-1 w-full min-w-48 rounded-md border border-line bg-surface p-2 shadow-lg">
          {FILTER_STATUSES.map((s) => (
            <label key={s} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-surface-2">
              <input type="checkbox" name="status" value={s} defaultChecked={selected.includes(s)} className="accent-[#ce102c]" />
              {STATUS_LABEL[s]}
            </label>
          ))}
          <p className="px-2 pt-1 text-[11px] text-muted">Select one or more, then Apply.</p>
        </div>
      </details>
    </div>
  );
}

/** Rebuilds a query string from page searchParams, keeping repeated keys (e.g. several statuses). */
export function toQuery(sp: Record<string, string | string[] | undefined>, set: Record<string, string | null> = {}, omit: string[] = []) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (omit.includes(k) || k in set || v == null) continue;
    for (const x of Array.isArray(v) ? v : [v]) if (x) p.append(k, x);
  }
  for (const [k, v] of Object.entries(set)) if (v != null) p.set(k, v);
  return p.toString();
}
