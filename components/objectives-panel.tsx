import Link from "next/link";
import { sql } from "drizzle-orm";
import { Paperclip, X } from "lucide-react";
import { db } from "@/db";
import { canManageObjectives, isCompanyManager, isExecutive, type CurrentUser } from "@/lib/auth";
import { objectiveVisibility } from "@/lib/objectives";
import { actionVisibility } from "@/lib/access";
import type { Lookup } from "@/lib/queries";
import { CATEGORIES, CATEGORY_LABEL, type Category } from "@/lib/constants";
import { fmtDate, todayISO } from "@/lib/dates";
import { ActionForm, SubmitButton } from "./forms";
import { Badge, Field, Progress, cx } from "./ui";
import { addItem, archiveObjective, completeItem, createObjective, decideItem } from "@/app/(app)/objectives/mutations";

type Row = Record<string, unknown>;

/** Small 30/60/90 summary card for the Overview page. Opens the checklist in place. */
export function ObjectivesCard({ progress, href }: { progress: { horizon: string; items: number; done: number; pct: number }[]; href: (h: string) => string }) {
  return (
    <section className="card min-w-0">
      <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <h2 className="section-title">30 / 60 / 90-day objectives</h2>
        <Link href={href("30")} className="text-xs font-medium text-accent hover:underline">Open checklist</Link>
      </header>
      <div className="grid grid-cols-3 divide-x divide-line">
        {progress.map((o) => (
          <Link key={o.horizon} href={href(o.horizon.replace("-day", ""))} className="block px-4 py-3 hover:bg-surface-2">
            <p className="text-xs text-muted">{o.horizon}</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{o.pct}%</p>
            <p className="text-[11px] text-muted">{o.done} of {o.items} approved</p>
          </Link>
        ))}
      </div>
    </section>
  );
}

/** The compact checklist: add deliverables, mark complete with evidence, approve — without leaving Overview. */
export async function ObjectivesPanel({ u, horizon, lk, closeHref, tabHref }: { u: CurrentUser; horizon: string; lk: Lookup; closeHref: string; tabHref: (h: string) => string }) {
  const [objs, items, files, actions] = await Promise.all([
    db.execute(sql`SELECT o.*, o.due_date::text AS due, org.code AS org_code, ow.name AS owner_name FROM objectives o
                   LEFT JOIN organizations org ON org.id = o.organization_id LEFT JOIN users ow ON ow.id = o.owner_id
                   WHERE o.archived_at IS NULL AND o.horizon = ${horizon} AND ${objectiveVisibility(u)} ORDER BY o.due_date NULLS LAST, o.id`),
    db.execute(sql`SELECT i.*, i.deadline::text AS dl, r.name AS responsible_name, ab.name AS approver_name, a.code AS action_code, o.owner_id, o.created_by AS obj_created_by
                   FROM objective_items i JOIN objectives o ON o.id = i.objective_id LEFT JOIN users r ON r.id = i.responsible_id
                   LEFT JOIN users ab ON ab.id = i.approved_by LEFT JOIN action_plans a ON a.id = i.action_id
                   WHERE o.archived_at IS NULL AND o.horizon = ${horizon} AND ${objectiveVisibility(u)} ORDER BY i.id`),
    db.execute(sql`SELECT f.id, f.filename, f.objective_item_id FROM attachments f JOIN objective_items i ON i.id = f.objective_item_id JOIN objectives o ON o.id = i.objective_id
                   WHERE f.deleted_at IS NULL AND o.horizon = ${horizon} AND ${objectiveVisibility(u)}`),
    db.execute(sql`SELECT a.id, a.code, left(a.point_task, 70) AS t FROM action_plans a WHERE ${actionVisibility(u)} ORDER BY a.id`),
  ]);
  const manage = canManageObjectives(u);
  const today = todayISO();
  const byObj = new Map<number, Row[]>();
  for (const it of items.rows as Row[]) byObj.set(it.objective_id as number, [...(byObj.get(it.objective_id as number) ?? []), it]);
  const approverOf = (it: Row) =>
    isExecutive(u) || isCompanyManager(u) || u.permissions.has("manage_objectives") || u.permissions.has("approve_completion") || it.owner_id === u.id || it.obj_created_by === u.id;

  return (
    <section id="objectives" className="card min-w-0 border-orange/60">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="section-title">Objectives checklist</h2>
          <nav className="flex gap-1" aria-label="Horizon">
            {["30", "60", "90"].map((x) => (
              <Link key={x} href={tabHref(x)} aria-current={x === horizon ? "page" : undefined} className={cx("btn btn-sm", x === horizon ? "btn-primary" : "btn-secondary")}>{x}-day</Link>
            ))}
          </nav>
        </div>
        <Link href={closeHref} className="btn btn-ghost btn-sm" aria-label="Close checklist"><X size={14} /> Close</Link>
      </header>
      <div className="divide-y divide-line">
        {objs.rows.length === 0 && <p className="px-4 py-6 text-center text-sm text-muted">No {horizon}-day objectives yet.</p>}
        {(objs.rows as Row[]).map((o) => {
          const list = byObj.get(o.id as number) ?? [];
          const approved = list.filter((i) => i.approval_status === "approved").length;
          const pct = list.length ? Math.round((approved / list.length) * 100) : 0;
          return (
            <div key={String(o.id)} className="px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{String(o.title)}</p>
                  <p className="text-xs text-muted">{o.org_code ? `${o.org_code} · ` : ""}{o.category ? `${CATEGORY_LABEL[o.category as Category]} · ` : ""}Owner {String(o.owner_name ?? "—")}{o.due ? ` · due ${fmtDate(o.due as string)}` : ""}</p>
                </div>
                <div className="w-36"><Progress value={pct} /></div>
              </div>
              <ul className="mt-2 space-y-2">
                {list.map((it) => {
                  const status = String(it.approval_status);
                  const late = !it.is_done && it.dl && (it.dl as string) < today;
                  const mine = it.responsible_id === u.id;
                  const evid = (files.rows as Row[]).filter((f) => f.objective_item_id === it.id);
                  return (
                    <li key={String(it.id)} className="rounded-md border border-line px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span aria-hidden className={cx("flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px]", status === "approved" ? "border-ok bg-ok text-white" : it.is_done ? "border-orange text-orange" : "border-line-strong")}>{status === "approved" ? "✓" : it.is_done ? "•" : ""}</span>
                        <span className={cx("min-w-0 flex-1", status === "approved" && "text-muted")}>{String(it.deliverable)}</span>
                        {status === "pending" && <Badge tone="warn">Awaiting approval</Badge>}
                        {status === "approved" && <Badge tone="ok">Approved · {String(it.approver_name)}</Badge>}
                        {status === "rejected" && <Badge tone="danger">Rework</Badge>}
                        {!!late && <Badge tone="danger">Overdue</Badge>}
                      </div>
                      <p className="mt-0.5 pl-6 text-xs text-muted">
                        {String(it.responsible_name ?? "Unassigned")}{it.dl ? ` · ${fmtDate(it.dl as string)}` : ""}
                        {it.action_code ? <> · <Link className="link" href={`/actions/${it.action_id}`}>{String(it.action_code)}</Link></> : null}
                        {it.evidence_note ? ` · Evidence: ${it.evidence_note}` : ""}
                      </p>
                      {evid.length > 0 && <div className="pl-6">{evid.map((f) => <a key={String(f.id)} href={`/api/attachments/${f.id}`} className="link mr-3 inline-flex items-center gap-1 text-xs"><Paperclip size={12} />{String(f.filename)}</a>)}</div>}
                      {!it.is_done && (mine || approverOf(it)) && (
                        <ActionForm action={completeItem} className="mt-2 flex flex-wrap items-end gap-2 pl-6">
                          <input type="hidden" name="itemId" value={String(it.id)} />
                          <input className="input h-8 w-60 text-xs" name="evidenceNote" placeholder="Evidence (note, reference, figure)" maxLength={2000} aria-label="Evidence" />
                          <input type="file" name="file" className="text-xs text-fg-2 file:mr-2 file:rounded file:border-0 file:bg-surface-3 file:px-2 file:py-1 file:text-fg" aria-label="Evidence file" />
                          <SubmitButton className="btn btn-secondary btn-sm">Mark complete</SubmitButton>
                        </ActionForm>
                      )}
                      {status === "pending" && approverOf(it) && it.done_by !== u.id && (
                        <ActionForm action={decideItem} className="mt-2 flex flex-wrap items-end gap-2 pl-6">
                          <input type="hidden" name="itemId" value={String(it.id)} />
                          <input className="input h-8 w-52 text-xs" name="note" placeholder="Note (required to reject)" maxLength={1000} aria-label="Decision note" />
                          <button name="decision" value="approved" className="btn btn-primary btn-sm">Approve</button>
                          <button name="decision" value="rejected" className="btn btn-danger btn-sm">Reject</button>
                        </ActionForm>
                      )}
                      {!!it.is_done && (mine || approverOf(it)) && (status !== "approved" || approverOf(it)) && (
                        <ActionForm action={completeItem} className="mt-1 pl-6"><input type="hidden" name="itemId" value={String(it.id)} /><input type="hidden" name="undo" value="1" /><SubmitButton className="btn btn-ghost btn-sm">Reopen</SubmitButton></ActionForm>
                      )}
                    </li>
                  );
                })}
              </ul>
              {manage && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs font-medium text-fg-2 hover:text-accent">Add deliverable</summary>
                  <ActionForm action={addItem} className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                    <input type="hidden" name="objectiveId" value={String(o.id)} />
                    <Field label="Deliverable" className="lg:col-span-2"><input className="input h-8" name="deliverable" required maxLength={1000} /></Field>
                    <Field label="Responsible"><select className="input h-8" name="responsibleId" defaultValue=""><option value="">—</option>{lk.users.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
                    <Field label="Deadline"><input className="input h-8" type="date" name="deadline" /></Field>
                    <Field label="Linked action"><select className="input h-8" name="actionId" defaultValue=""><option value="">—</option>{(actions.rows as { id: number; code: string; t: string }[]).map((a) => <option key={a.id} value={a.id}>{a.code} · {a.t}</option>)}</select></Field>
                    <div className="flex gap-2 sm:col-span-2 lg:col-span-5">
                      <SubmitButton className="btn btn-secondary btn-sm">Add deliverable</SubmitButton>
                    </div>
                  </ActionForm>
                  <ActionForm action={archiveObjective} className="mt-1"><input type="hidden" name="objectiveId" value={String(o.id)} /><SubmitButton className="btn btn-ghost btn-sm" confirm="Archive this objective?">Archive objective</SubmitButton></ActionForm>
                </details>
              )}
            </div>
          );
        })}
      </div>
      {manage && (
        <details className="border-t border-line px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium text-accent">New {horizon}-day objective</summary>
          <ActionForm action={createObjective} className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <input type="hidden" name="horizon" value={horizon} />
            <Field label="Objective" className="sm:col-span-2"><input className="input" name="title" required maxLength={300} /></Field>
            <Field label="Company"><select className="input" name="organizationId" defaultValue=""><option value="">All</option>{lk.orgs.map((o) => <option key={o.id} value={o.id}>{o.code}</option>)}</select></Field>
            <Field label="Objective area"><select className="input" name="category" defaultValue=""><option value="">—</option>{CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}</select></Field>
            <Field label="Owner"><select className="input" name="ownerId" defaultValue={u.id}>{lk.users.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
            <Field label="Start"><input className="input" type="date" name="startDate" /></Field>
            <Field label="Due"><input className="input" type="date" name="dueDate" /></Field>
            <Field label="Description"><input className="input" name="description" maxLength={4000} /></Field>
            <div className="sm:col-span-2 lg:col-span-4"><SubmitButton className="btn btn-primary btn-sm">Create objective</SubmitButton></div>
          </ActionForm>
        </details>
      )}
    </section>
  );
}
