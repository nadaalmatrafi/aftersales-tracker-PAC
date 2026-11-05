import Link from "next/link";
import { AlertTriangle, Flame } from "lucide-react";
import type { ActionRow } from "@/lib/queries";
import { fmtDate, fmtRelative } from "@/lib/dates";
import type { Priority } from "@/lib/constants";
import { EmptyState, OrgTags, PriorityBadge, Progress, StatusBadge } from "./ui";

export function WaitingOn({ a }: { a: ActionRow }) {
  if (a.waiting_reason === "closed") return <span className="text-muted">—</span>;
  return (
    <div className="min-w-40">
      <div className="flex items-center gap-1.5 font-medium text-fg">
        {a.step_blocked && <AlertTriangle size={13} className="text-accent" aria-label="Blocked" />}
        {a.waiting_on_name}
      </div>
      {a.acting_for && <div className="text-[11px] font-medium text-orange">covering for {a.acting_for}</div>}
      <div className="text-xs text-muted">
        {a.waiting_reason === "approval" ? "Approval decision" : a.waiting_on_step ?? "Owner"}
        {a.waiting_on_dept ? ` · ${a.waiting_on_dept}` : ""}
      </div>
      {a.waiting_since && <div className="text-[11px] text-muted">since {fmtRelative(a.waiting_since)}</div>}
    </div>
  );
}

export function ActionTable({ rows, compact, emptyText = "No action plans match these filters." }: { rows: ActionRow[]; compact?: boolean; emptyText?: string }) {
  if (!rows.length) return <EmptyState title={emptyText} />;
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>Point / Task</th>
            {!compact && <th>Department</th>}
            {!compact && <th>Responsible</th>}
            <th>Currently with</th>
            <th>Remaining</th>
            <th>Target</th>
            <th>Status</th>
            <th className={compact ? "w-24" : "w-32"}>Progress</th>
            {!compact && <th>Last update</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id}>
              <td className={compact ? "min-w-56 max-w-[24rem]" : "min-w-72 max-w-[28rem]"}>
                <div className="mb-1 flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] font-semibold tabular-nums text-muted">{a.code}</span>
                  <OrgTags codes={a.org_codes} />
                  {a.priority !== "medium" && <PriorityBadge priority={a.priority as Priority} />}
                  {a.is_escalated && (
                    <span className="inline-flex items-center gap-0.5 text-[11px] text-accent">
                      <Flame size={12} aria-hidden /> Escalated
                    </span>
                  )}
                </div>
                <Link href={`/actions/${a.id}`} className="link line-clamp-2">
                  {a.point_task}
                </Link>
                {compact && <p className="mt-1 text-xs text-muted">Responsible: <span className="text-fg-2">{a.owner_name}</span>{a.department ? ` · ${a.department}` : ""}</p>}
                {a.blocker && <p className="mt-1 line-clamp-1 text-xs text-accent">Blocker: {a.blocker}</p>}
              </td>
              {!compact && <td className="text-fg-2">{a.department ?? <span className="text-muted">Unassigned</span>}</td>}
              {!compact && (
                <td>
                  <div className="text-fg">{a.owner_name}</div>
                  {a.suggested_responsible && a.suggested_responsible !== "To Be Assigned" && (
                    <div className="text-[11px] text-muted">Suggested: {a.suggested_responsible}</div>
                  )}
                </td>
              )}
              <td>
                <WaitingOn a={a} />
              </td>
              <td className="text-xs text-fg-2">
                {a.steps_total > 0 ? (
                  <>
                    <span className="tabular-nums">
                      {a.steps_total - a.steps_done} of {a.steps_total} steps
                    </span>
                    {a.remaining_steps.length > 0 && <div className={`line-clamp-2 text-[11px] text-muted ${compact ? "max-w-36" : "max-w-48"}`}>{a.remaining_steps.join(" → ")}</div>}
                  </>
                ) : (
                  <span className="text-muted">No steps</span>
                )}
              </td>
              <td className="whitespace-nowrap">
                {a.target_date ? fmtDate(a.target_date) : <span className="text-muted">{a.timeline_note ?? "Not set"}</span>}
              </td>
              <td>
                <StatusBadge status={a.effective_status} />
              </td>
              <td>
                <Progress value={a.progress} />
              </td>
              {!compact && (
                <td className="max-w-56 text-xs">
                  <div className="text-fg-2">{fmtRelative(a.last_update_at)}</div>
                  {a.last_update_note && <div className="line-clamp-2 text-muted">{a.last_update_note}</div>}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
