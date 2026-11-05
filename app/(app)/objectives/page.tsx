import Link from "next/link";
import { sql } from "drizzle-orm";
import { Paperclip } from "lucide-react";
import { db } from "@/db";
import { requireUser, canManageObjectives, isExecutive } from "@/lib/auth";
import { objectiveVisibility } from "@/lib/objectives";
import { actionVisibility } from "@/lib/access";
import { lookups } from "@/lib/queries";
import { CATEGORIES, CATEGORY_LABEL, type Category } from "@/lib/constants";
import { fmtDate, todayISO } from "@/lib/dates";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, EmptyState, Field, PageHeader, Progress, Section, cx } from "@/components/ui";
import { addItem, archiveObjective, completeItem, createObjective, decideItem } from "./mutations";

export const metadata = { title: "30 / 60 / 90-Day Objectives" };

const FOCUS: Record<string, string> = {
  "30": "Immediate execution — activate initiatives, launch priority activities, establish baselines.",
  "60": "Implementation and improvement — complete assessments, run programs, evaluate effectiveness.",
  "90": "Business results — measure revenue, savings, productivity and acquisition outcomes.",
};

export default async function ObjectivesPage({ searchParams }: { searchParams: Promise<{ h?: string }> }) {
  const u = await requireUser();
  const h = ["30", "60", "90"].includes((await searchParams).h ?? "") ? (await searchParams).h! : "30";
  const [objs, items, files, lk, actions] = await Promise.all([
    db.execute(sql`SELECT o.*, o.due_date::text AS due, org.code AS org_code, ow.name AS owner_name FROM objectives o
                   LEFT JOIN organizations org ON org.id = o.organization_id LEFT JOIN users ow ON ow.id = o.owner_id
                   WHERE o.archived_at IS NULL AND o.horizon = ${h} AND ${objectiveVisibility(u)} ORDER BY o.due_date NULLS LAST, o.id`),
    db.execute(sql`SELECT i.*, i.deadline::text AS dl, r.name AS responsible_name, ab.name AS approver_name, a.code AS action_code, o.owner_id, o.created_by AS obj_created_by
                   FROM objective_items i JOIN objectives o ON o.id = i.objective_id LEFT JOIN users r ON r.id = i.responsible_id
                   LEFT JOIN users ab ON ab.id = i.approved_by LEFT JOIN action_plans a ON a.id = i.action_id
                   WHERE o.archived_at IS NULL AND o.horizon = ${h} AND ${objectiveVisibility(u)} ORDER BY i.id`),
    db.execute(sql`SELECT f.id, f.filename, f.objective_item_id FROM attachments f JOIN objective_items i ON i.id = f.objective_item_id JOIN objectives o ON o.id = i.objective_id
                   WHERE f.deleted_at IS NULL AND o.horizon = ${h} AND ${objectiveVisibility(u)}`),
    lookups(),
    db.execute(sql`SELECT a.id, a.code, left(a.point_task, 80) AS t FROM action_plans a WHERE ${actionVisibility(u)} ORDER BY a.id`),
  ]);
  const manage = canManageObjectives(u);
  const today = todayISO();
  type Item = Record<string, unknown>;
  const byObj = new Map<number, Item[]>();
  for (const it of items.rows as Item[]) byObj.set(it.objective_id as number, [...(byObj.get(it.objective_id as number) ?? []), it]);
  const approverOf = (it: Item) => isExecutive(u) || u.permissions.has("manage_objectives") || u.permissions.has("approve_completion") || it.owner_id === u.id || it.obj_created_by === u.id;

  return (
    <>
      <PageHeader title="30 / 60 / 90-Day Objectives" subtitle="Checklist of measurable deliverables. Completion counts only manager-approved deliverables." />
      <nav className="mb-4 flex gap-1" aria-label="Horizon">
        {["30", "60", "90"].map((x) => (
          <Link key={x} href={`/objectives?h=${x}`} aria-current={x === h ? "page" : undefined} className={cx("btn", x === h ? "btn-primary" : "btn-secondary")}>{x}-day</Link>
        ))}
      </nav>
      <p className="mb-5 text-sm text-muted">{FOCUS[h]}</p>

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          {objs.rows.length === 0 && <EmptyState title={`No ${h}-day objectives yet.`}>{manage ? "Create the first objective using the form." : null}</EmptyState>}
          {(objs.rows as Item[]).map((o) => {
            const list = byObj.get(o.id as number) ?? [];
            const approved = list.filter((i) => i.approval_status === "approved").length;
            const pct = list.length ? Math.round((approved / list.length) * 100) : 0;
            return (
              <section key={String(o.id)} className="card">
                <header className="border-b border-line p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h2 className="font-semibold">{String(o.title)}</h2>
                      <p className="mt-0.5 text-xs text-muted">{o.org_code ? `${o.org_code} · ` : ""}{o.category ? `${CATEGORY_LABEL[o.category as Category]} · ` : ""}Owner: {String(o.owner_name ?? "—")} · Due {fmtDate(o.due as string)}</p>
                    </div>
                    <div className="w-40"><Progress value={pct} /><p className="mt-0.5 text-right text-[11px] text-muted">{approved}/{list.length} approved</p></div>
                  </div>
                  {!!o.description && <p className="mt-2 whitespace-pre-line text-sm text-fg-2">{String(o.description)}</p>}
                </header>
                <ul className="divide-y divide-line">
                  {list.length === 0 && <li className="p-4 text-sm text-muted">No deliverables yet.</li>}
                  {list.map((it) => {
                    const status = String(it.approval_status);
                    const late = !it.is_done && it.dl && (it.dl as string) < today;
                    const mine = it.responsible_id === u.id;
                    const evid = (files.rows as Item[]).filter((f) => f.objective_item_id === it.id);
                    return (
                      <li key={String(it.id)} className="p-4">
                        <div className="flex flex-wrap items-start gap-3">
                          <span aria-hidden className={cx("mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px]", status === "approved" ? "border-ok bg-ok text-black" : it.is_done ? "border-warn text-warn" : "border-line-strong")}>{status === "approved" ? "✓" : it.is_done ? "•" : ""}</span>
                          <div className="min-w-0 flex-1">
                            <p className={cx("text-sm", status === "approved" && "text-fg-2")}>{String(it.deliverable)}</p>
                            <p className="mt-0.5 text-xs text-muted">
                              {String(it.responsible_name ?? "Unassigned")} · {it.dl ? `deadline ${fmtDate(it.dl as string)}` : "no deadline"}
                              {it.action_code ? <> · <Link className="link" href={`/actions/${it.action_id}`}>{String(it.action_code)}</Link></> : null}
                            </p>
                            <div className="mt-1 flex flex-wrap gap-1.5">
                              {status === "pending" && <Badge tone="warn">Awaiting manager approval</Badge>}
                              {status === "approved" && <Badge tone="ok">Approved by {String(it.approver_name)}</Badge>}
                              {status === "rejected" && <Badge tone="danger">Rejected — rework required</Badge>}
                              {!!late && <Badge tone="danger">Overdue</Badge>}
                            </div>
                            {!!it.evidence_note && <p className="mt-1 text-xs text-fg-2">Evidence: {String(it.evidence_note)}</p>}
                            {evid.map((f) => <a key={String(f.id)} href={`/api/attachments/${f.id}`} className="link mr-3 mt-1 inline-flex items-center gap-1 text-xs"><Paperclip size={12} />{String(f.filename)}</a>)}
                            {!it.is_done && (mine || approverOf(it)) && (
                              <ActionForm action={completeItem} className="mt-2 flex flex-wrap items-end gap-2">
                                <input type="hidden" name="itemId" value={String(it.id)} />
                                <input className="input h-8 w-64 text-xs" name="evidenceNote" placeholder="Evidence (note, reference, figure)" maxLength={2000} aria-label="Evidence" />
                                <input type="file" name="file" className="text-xs text-fg-2 file:mr-2 file:rounded file:border-0 file:bg-surface-3 file:px-2 file:py-1 file:text-fg" aria-label="Evidence file" />
                                <SubmitButton className="btn btn-secondary btn-sm">Mark complete</SubmitButton>
                              </ActionForm>
                            )}
                            {status === "pending" && approverOf(it) && it.done_by !== u.id && (
                              <ActionForm action={decideItem} className="mt-2 flex flex-wrap items-end gap-2">
                                <input type="hidden" name="itemId" value={String(it.id)} />
                                <input className="input h-8 w-56 text-xs" name="note" placeholder="Note (required to reject)" maxLength={1000} aria-label="Decision note" />
                                <button name="decision" value="approved" className="btn btn-primary btn-sm">Approve</button>
                                <button name="decision" value="rejected" className="btn btn-danger btn-sm">Reject</button>
                              </ActionForm>
                            )}
                            {!!it.is_done && (mine || approverOf(it)) && (status !== "approved" || approverOf(it)) && (
                              <ActionForm action={completeItem} className="mt-1"><input type="hidden" name="itemId" value={String(it.id)} /><input type="hidden" name="undo" value="1" /><SubmitButton className="btn btn-ghost btn-sm">Reopen</SubmitButton></ActionForm>
                            )}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {manage && (
                  <div className="border-t border-line p-4">
                    <ActionForm action={addItem} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                      <input type="hidden" name="objectiveId" value={String(o.id)} />
                      <Field label="Deliverable" className="lg:col-span-2"><input className="input" name="deliverable" required maxLength={1000} /></Field>
                      <Field label="Responsible">
                        <select className="input" name="responsibleId" defaultValue=""><option value="">—</option>{lk.users.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
                      </Field>
                      <Field label="Deadline"><input className="input" type="date" name="deadline" /></Field>
                      <Field label="Linked action">
                        <select className="input" name="actionId" defaultValue=""><option value="">—</option>{(actions.rows as { id: number; code: string; t: string }[]).map((a) => <option key={a.id} value={a.id}>{a.code} · {a.t}</option>)}</select>
                      </Field>
                      <div className="flex gap-2 sm:col-span-2 lg:col-span-5">
                        <SubmitButton className="btn btn-secondary btn-sm">Add deliverable</SubmitButton>
                      </div>
                    </ActionForm>
                    <ActionForm action={archiveObjective} className="mt-2"><input type="hidden" name="objectiveId" value={String(o.id)} /><SubmitButton className="btn btn-ghost btn-sm" confirm="Archive this objective?">Archive objective</SubmitButton></ActionForm>
                  </div>
                )}
              </section>
            );
          })}
        </div>
        {manage && (
          <Section title="New objective">
            <ActionForm action={createObjective} className="space-y-3">
              <Field label="Objective"><input className="input" name="title" required maxLength={300} /></Field>
              <Field label="Description"><textarea className="input" name="description" rows={2} maxLength={4000} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Horizon"><select className="input" name="horizon" defaultValue={h}><option value="30">30-day</option><option value="60">60-day</option><option value="90">90-day</option></select></Field>
                <Field label="Organization"><select className="input" name="organizationId" defaultValue=""><option value="">All</option>{lk.orgs.map((o) => <option key={o.id} value={o.id}>{o.code}</option>)}</select></Field>
              </div>
              <Field label="Objective area"><select className="input" name="category" defaultValue=""><option value="">—</option>{CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}</select></Field>
              <Field label="Owner"><select className="input" name="ownerId" defaultValue={u.id}>{lk.users.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Start"><input className="input" type="date" name="startDate" /></Field>
                <Field label="Due"><input className="input" type="date" name="dueDate" /></Field>
              </div>
              <SubmitButton>Create objective</SubmitButton>
            </ActionForm>
          </Section>
        )}
      </div>
    </>
  );
}
