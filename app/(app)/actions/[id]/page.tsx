import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";
import { ArrowDown, ArrowUp, Flame, Paperclip } from "lucide-react";
import { db } from "@/db";
import { requireUser, canSeeConfidential, isExecutive } from "@/lib/auth";
import { listActions, loadActionAccess, lookups } from "@/lib/queries";
import { canApproveAction, canDeleteAction, canManageAction, canManageSteps, canReassignAction, canUpdateAction, isActionOwner } from "@/lib/access";
import { CATEGORY_LABEL, STEP_STATUSES, STEP_STATUS_LABEL, type Category, type Priority, type StepStatus } from "@/lib/constants";
import { fmtDate, fmtDateTime, fmtRelative } from "@/lib/dates";
import { ActionForm, SubmitButton } from "@/components/forms";
import { ActionFields } from "@/components/action-fields";
import { Badge, EmptyState, Field, OrgTags, PriorityBadge, Progress, Section, StatusBadge, StepBadge } from "@/components/ui";
import {
  addComment,
  addStep,
  decideApproval,
  deleteAction,
  editAction,
  editStep,
  escalateAction,
  postUpdate,
  reassignAction,
  removeAttachment,
  reopenAction,
  requestCompletion,
  requestExtension,
  saveImpact,
  setStepStatus,
  uploadAttachment,
} from "../mutations";

export const metadata = { title: "Action plan" };

type Row = Record<string, unknown>;
const q = async (s: ReturnType<typeof sql>) => (await db.execute(s)).rows as Row[];

export default async function ActionDetail({ params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser();
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const access = await loadActionAccess(u, id);
  if (!access) notFound();
  const [[a], lk, steps, updates, comments, files, approvals, assignments, impactRows, extra, history] = await Promise.all([
    listActions(u, { ids: [id] }),
    lookups(),
    q(sql`SELECT s.*, s.due_date::text AS due, u.name AS assignee_name, d.name AS dept_name, cb.name AS completed_by_name
            FROM action_steps s LEFT JOIN users u ON u.id = s.assignee_id LEFT JOIN departments d ON d.id = s.department_id
            LEFT JOIN users cb ON cb.id = s.completed_by WHERE s.action_id = ${id} ORDER BY s.sequence`),
    q(sql`SELECT x.*, u.name FROM action_updates x JOIN users u ON u.id = x.user_id WHERE x.action_id = ${id} ORDER BY x.created_at DESC LIMIT 100`),
    q(sql`SELECT c.*, u.name FROM action_comments c JOIN users u ON u.id = c.user_id WHERE c.action_id = ${id} ORDER BY c.created_at`),
    q(sql`SELECT f.id, f.filename, f.size_bytes, f.created_at, f.uploaded_by, u.name FROM attachments f JOIN users u ON u.id = f.uploaded_by
            WHERE f.action_id = ${id} AND f.deleted_at IS NULL ORDER BY f.created_at DESC`),
    q(sql`SELECT r.*, r.requested_date::text AS req_date, rb.name AS requester, db.name AS decider FROM approval_records r
            JOIN users rb ON rb.id = r.requested_by LEFT JOIN users db ON db.id = r.decided_by WHERE r.action_id = ${id} ORDER BY r.requested_at DESC`),
    q(sql`SELECT x.*, f.name AS from_name, t.name AS to_name, b.name AS by_name FROM action_assignments x
            LEFT JOIN users f ON f.id = x.from_user_id JOIN users t ON t.id = x.to_user_id LEFT JOIN users b ON b.id = x.assigned_by_id
            WHERE x.action_id = ${id} ORDER BY x.created_at`),
    q(sql`SELECT i.*, cu.name AS confirmed_name FROM impact_records i LEFT JOIN users cu ON cu.id = i.actuals_confirmed_by WHERE i.action_id = ${id}`),
    q(sql`SELECT a.is_confidential, a.escalation_note, a.escalated_at, a.meeting_id, m.title AS meeting_title, ab.name AS approved_by,
            COALESCE((SELECT array_agg(organization_id) FROM action_organizations WHERE action_id = a.id), '{}') AS org_ids,
            COALESCE((SELECT array_agg(department_id) FROM action_departments WHERE action_id = a.id), '{}') AS support_ids,
            COALESCE((SELECT array_agg(d.org_code || ' · ' || d.name) FROM action_departments ad JOIN (SELECT dd.id, dd.name, o.code AS org_code FROM departments dd JOIN organizations o ON o.id = dd.organization_id) d ON d.id = ad.department_id WHERE ad.action_id = a.id), '{}') AS support_names,
            COALESCE((SELECT array_agg(c.user_id::text) FROM action_contributors c WHERE c.action_id = a.id), '{}') AS contributor_ids,
            COALESCE((SELECT array_agg(uu.name) FROM action_contributors c JOIN users uu ON uu.id = c.user_id WHERE c.action_id = a.id), '{}') AS contributor_names
          FROM action_plans a LEFT JOIN meetings m ON m.id = a.meeting_id LEFT JOIN users ab ON ab.id = a.approved_by_id WHERE a.id = ${id}`),
    q(sql`SELECT l.action, l.created_at, l.changes, u.name FROM audit_logs l LEFT JOIN users u ON u.id = l.actor_id
            WHERE (l.entity_type = 'action' AND l.entity_id = ${String(id)}) ORDER BY l.created_at DESC LIMIT 50`),
  ]);
  if (!a) notFound();
  const x = extra[0];
  const impact = impactRows[0];
  const manage = canManageAction(u, access);
  const update = canUpdateAction(u, access);
  const stepsAllowed = canManageSteps(u, access);
  const closed = a.status === "completed" || a.status === "cancelled";
  const pending = approvals.filter((r) => r.status === "pending");
  const hidden = <input type="hidden" name="actionId" value={id} />;

  return (
    <div className="space-y-5">
      <div>
        <Link href="/actions" className="text-xs text-muted hover:text-fg">← Action Plans</Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold tabular-nums text-muted">{a.code}</span>
          <OrgTags codes={a.org_codes} />
          <StatusBadge status={a.effective_status} />
          <PriorityBadge priority={a.priority as Priority} />
          {!!x.is_confidential && <Badge tone="warn">Confidential</Badge>}
          {a.is_escalated && <Badge tone="danger"><Flame size={11} aria-hidden /> Escalated</Badge>}
        </div>
        <h1 className="mt-2 max-w-4xl text-lg font-semibold leading-snug">{a.point_task}</h1>
      </div>

      {/* Where it stands — the CEO's answer in one panel */}
      <section className="card grid gap-4 border-l-2 border-l-accent p-4 md:grid-cols-4" aria-label="Current position">
        <div>
          <p className="text-[11px] uppercase tracking-wider text-muted">Currently with</p>
          <p className="mt-1 text-base font-semibold">{closed ? "Closed" : a.waiting_on_name}</p>
          {!closed && (
            <p className="text-xs text-muted">
              {a.waiting_reason === "approval" ? "Approval decision" : a.waiting_on_step ?? "Accountable owner"}
              {a.waiting_on_dept ? ` · ${a.waiting_on_dept}` : ""}
              {a.waiting_since ? ` · since ${fmtRelative(a.waiting_since)}` : ""}
            </p>
          )}
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wider text-muted">Progress</p>
          <div className="mt-2"><Progress value={a.progress} /></div>
          <p className="mt-1 text-xs text-muted">{a.steps_total ? `${a.steps_done} of ${a.steps_total} steps complete` : "No workflow steps — progress reported manually"}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wider text-muted">What remains</p>
          {a.remaining_steps.length ? (
            <ol className="mt-1 list-decimal pl-4 text-xs text-fg-2">{a.remaining_steps.slice(0, 4).map((s, i) => <li key={i}>{s}</li>)}{a.remaining_steps.length > 4 && <li className="list-none text-muted">+{a.remaining_steps.length - 4} more</li>}</ol>
          ) : (
            <p className="mt-1 text-xs text-muted">{closed ? "Nothing — action closed." : a.status === "pending_approval" ? "Management approval" : "Define workflow steps to track hand-offs."}</p>
          )}
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wider text-muted">Target</p>
          <p className="mt-1 font-medium">{a.target_date ? fmtDate(a.target_date) : "No date set"}</p>
          {a.timeline_note && <p className="text-xs text-muted">Original timeline: {a.timeline_note}</p>}
          {a.blocker && <p className="mt-2 text-xs text-[#ff7b82]">Blocker: {a.blocker}</p>}
          {a.is_escalated && !!x.escalation_note && <p className="mt-1 text-xs text-[#ff7b82]">Escalation: {String(x.escalation_note)}</p>}
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Section title="Workflow & hand-offs">
            {steps.length === 0 ? (
              <EmptyState title="No workflow steps yet.">Break the action into steps across teams so everyone sees where it stands and who holds it.</EmptyState>
            ) : (
              <ol className="space-y-2">
                {steps.map((s, i) => {
                  const mine = s.assignee_id === u.id;
                  const canAct = !closed && (stepsAllowed || mine);
                  const isCurrent = a.waiting_reason === "step" && a.waiting_on_step === s.title && !["done", "skipped"].includes(String(s.status));
                  return (
                    <li key={String(s.id)} data-step={String(s.id)} className={`rounded-lg border p-3 ${isCurrent ? "border-accent/60 bg-accent-soft/30" : "border-line"}`}>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs tabular-nums text-muted">{i + 1}.</span>
                            <span className="font-medium">{String(s.title)}</span>
                            <StepBadge status={s.status as StepStatus} />
                            {isCurrent && <Badge tone="accent">Current</Badge>}
                          </div>
                          <p className="mt-0.5 text-xs text-muted">
                            {(s.assignee_name as string) ?? "Unassigned"}{s.dept_name ? ` · ${s.dept_name}` : ""}{s.due ? ` · due ${fmtDate(s.due as string)}` : ""}
                            {s.completed_at ? ` · ${s.status === "done" ? "done" : "skipped"} ${fmtDateTime(s.completed_at as string)}${s.completed_by_name ? ` by ${s.completed_by_name}` : ""}` : ""}
                          </p>
                          {!!s.blocker_note && <p className="mt-1 text-xs text-[#ff7b82]">Blocked: {String(s.blocker_note)}</p>}
                        </div>
                        {stepsAllowed && !closed && (
                          <div className="flex gap-1">
                            {(["up", "down"] as const).map((op) => (
                              <ActionForm key={op} action={editStep}>
                                <input type="hidden" name="stepId" value={String(s.id)} />
                                <input type="hidden" name="op" value={op} />
                                <button className="btn btn-ghost btn-sm" aria-label={`Move ${op}`}>{op === "up" ? <ArrowUp size={13} /> : <ArrowDown size={13} />}</button>
                              </ActionForm>
                            ))}
                            {s.status !== "done" && (
                              <ActionForm action={editStep}>
                                <input type="hidden" name="stepId" value={String(s.id)} />
                                <input type="hidden" name="op" value="delete" />
                                <SubmitButton className="btn btn-ghost btn-sm" confirm="Remove this step?">Remove</SubmitButton>
                              </ActionForm>
                            )}
                          </div>
                        )}
                      </div>
                      {canAct && !["done", "skipped"].includes(String(s.status)) && (
                        <div className="mt-2 flex flex-wrap items-end gap-2">
                          <ActionForm action={setStepStatus} className="flex flex-wrap items-end gap-2">
                            <input type="hidden" name="stepId" value={String(s.id)} />
                            <select className="input h-8 w-36 text-xs" name="status" defaultValue={s.status === "pending" ? "in_progress" : "done"} aria-label="New step status">
                              {STEP_STATUSES.filter((st) => st !== s.status && (st !== "skipped" || stepsAllowed)).map((st) => <option key={st} value={st}>{STEP_STATUS_LABEL[st]}</option>)}
                            </select>
                            <input className="input h-8 w-56 text-xs" name="note" placeholder="Note (required if blocked)" maxLength={1000} />
                            <SubmitButton className="btn btn-secondary btn-sm">Update step</SubmitButton>
                          </ActionForm>
                          {stepsAllowed && (
                            <ActionForm action={editStep} className="flex flex-wrap items-end gap-2">
                              <input type="hidden" name="stepId" value={String(s.id)} />
                              <input type="hidden" name="op" value="reassign" />
                              <select className="input h-8 w-44 text-xs" name="assigneeId" defaultValue={(s.assignee_id as string) ?? ""} aria-label="Step assignee">
                                <option value="">Unassigned</option>
                                {lk.users.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                              </select>
                              <input className="input h-8 w-36 text-xs" type="date" name="dueDate" defaultValue={(s.due as string) ?? ""} aria-label="Step due date" />
                              <SubmitButton className="btn btn-ghost btn-sm">Reassign</SubmitButton>
                            </ActionForm>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
            {stepsAllowed && !closed && (
              <ActionForm action={addStep} className="mt-4 grid gap-2 border-t border-line pt-4 sm:grid-cols-2 lg:grid-cols-5">
                {hidden}
                <Field label="Step" className="lg:col-span-2"><input className="input" name="title" required maxLength={500} placeholder="e.g. Finance to validate rental figures" /></Field>
                <Field label="Department">
                  <select className="input" name="departmentId" defaultValue="">
                    <option value="">—</option>
                    {lk.departments.map((d) => <option key={d.id} value={d.id}>{d.org_code} · {d.name}</option>)}
                  </select>
                </Field>
                <Field label="Assignee">
                  <select className="input" name="assigneeId" defaultValue="">
                    <option value="">Unassigned</option>
                    {lk.users.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </Field>
                <Field label="Due"><input className="input" type="date" name="dueDate" /></Field>
                <div className="sm:col-span-2 lg:col-span-5"><SubmitButton className="btn btn-secondary">Add step</SubmitButton></div>
              </ActionForm>
            )}
          </Section>

          {update && !closed && (
            <Section title="Post progress update">
              <ActionForm action={postUpdate} className="grid gap-3 sm:grid-cols-4">
                {hidden}
                <Field label="Update" className="sm:col-span-4"><textarea className="input" name="note" required maxLength={4000} rows={3} placeholder="What was done, what is next, any dependency." /></Field>
                {a.steps_total === 0 && (
                  <Field label="Progress %"><input className="input" type="number" name="progress" min={0} max={99} defaultValue={a.progress} /></Field>
                )}
                <Field label="Status">
                  <select className="input" name="status" defaultValue="">
                    <option value="">Unchanged</option>
                    <option value="not_started">Not Started</option>
                    <option value="in_progress">In Progress</option>
                    <option value="on_hold">On Hold</option>
                    {manage && <option value="cancelled">Cancelled</option>}
                  </select>
                </Field>
                <div className="flex flex-col justify-end gap-1 text-sm sm:col-span-2">
                  <label className="inline-flex items-center gap-2"><input type="checkbox" name="isBlocker" className="accent-[#e2242f]" /> Report as blocker</label>
                  {a.blocker && <label className="inline-flex items-center gap-2"><input type="checkbox" name="clearBlocker" className="accent-[#e2242f]" /> Blocker resolved</label>}
                </div>
                <div className="sm:col-span-4"><SubmitButton>Post update</SubmitButton></div>
              </ActionForm>
            </Section>
          )}

          <Section title={`Approvals${pending.length ? ` · ${pending.length} pending` : ""}`}>
            {approvals.length === 0 && <p className="mb-3 text-sm text-muted">No approval requests yet.</p>}
            <ul className="space-y-3">
              {approvals.map((r) => (
                <li key={String(r.id)} className="rounded-lg border border-line p-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium">{r.type === "completion" ? "Completion review" : `Deadline extension → ${fmtDate(r.req_date as string)}`}</span>
                    <Badge tone={r.status === "pending" ? "warn" : r.status === "approved" ? "ok" : "danger"}>{String(r.status)}</Badge>
                    <span className="text-xs text-muted">by {String(r.requester)} · {fmtDateTime(r.requested_at as string)}</span>
                  </div>
                  {!!r.request_note && <p className="mt-1 whitespace-pre-line text-sm text-fg-2">{String(r.request_note)}</p>}
                  {r.status !== "pending" && <p className="mt-1 text-xs text-muted">{String(r.status)} by {String(r.decider)} · {fmtDateTime(r.decided_at as string)}{r.decision_note ? ` — ${r.decision_note}` : ""}</p>}
                  {r.status === "pending" && canApproveAction(u, access, r.requested_by as string) && (
                    <ActionForm action={decideApproval} className="mt-2 flex flex-wrap items-end gap-2">
                      <input type="hidden" name="approvalId" value={String(r.id)} />
                      <input className="input h-8 max-w-80 text-xs" name="note" placeholder="Decision note (required to reject)" maxLength={2000} />
                      <button name="decision" value="approved" className="btn btn-primary btn-sm">Approve</button>
                      <button name="decision" value="rejected" className="btn btn-danger btn-sm">Reject</button>
                    </ActionForm>
                  )}
                </li>
              ))}
            </ul>
            {!closed && a.status !== "pending_approval" && (isActionOwner(u, access) || manage) && (
              <ActionForm action={requestCompletion} className="mt-4 grid gap-2 border-t border-line pt-4">
                {hidden}
                <Field label="Submit for completion review"><textarea className="input" name="note" rows={2} maxLength={2000} required placeholder="Summarize the delivered result and evidence." /></Field>
                <div><SubmitButton className="btn btn-secondary">Submit for approval</SubmitButton></div>
              </ActionForm>
            )}
            {!closed && update && (
              <details className="mt-3">
                <summary className="cursor-pointer text-sm text-fg-2 hover:text-fg">Request deadline extension</summary>
                <ActionForm action={requestExtension} className="mt-2 grid gap-2 sm:grid-cols-3">
                  {hidden}
                  <Field label="Proposed target date"><input className="input" type="date" name="requestedDate" required /></Field>
                  <Field label="Reason" className="sm:col-span-2"><input className="input" name="note" required maxLength={2000} /></Field>
                  <div><SubmitButton className="btn btn-secondary btn-sm">Request extension</SubmitButton></div>
                </ActionForm>
              </details>
            )}
          </Section>

          <Section title="Business impact">
            <ActionForm action={saveImpact} resetOnSuccess={false} className="space-y-4">
              {hidden}
              <div className="overflow-x-auto">
                <table className="table">
                  <thead><tr><th>Measure</th><th>Expected</th><th>Actual (confirmed)</th></tr></thead>
                  <tbody>
                    {([["Revenue (SAR)", "expectedRevenue", "actualRevenue", "expected_revenue", "actual_revenue"], ["Savings (SAR)", "expectedSavings", "actualSavings", "expected_savings", "actual_savings"], ["Cost (SAR)", "estimatedCost", "actualCost", "estimated_cost", "actual_cost"]] as const).map(([label, e, ac, ek, ak]) => (
                      <tr key={label}>
                        <td className="text-fg-2">{label}</td>
                        <td><input className="input h-8" name={e} inputMode="decimal" defaultValue={(impact?.[ek] as string) ?? ""} disabled={!update} aria-label={`Expected ${label}`} /></td>
                        <td><input className="input h-8" name={ac} inputMode="decimal" defaultValue={(impact?.[ak] as string) ?? ""} disabled={!update} aria-label={`Actual ${label}`} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {([["Branches affected", "branchesAffected", "branches_affected"], ["Employees affected", "employeesAffected", "employees_affected"], ["Productivity +%", "productivityImprovementPct", "productivity_improvement_pct"], ["Footfall +%", "footfallImprovementPct", "footfall_improvement_pct"], ["Capacity +%", "capacityImprovementPct", "capacity_improvement_pct"]] as const).map(([label, name, key]) => (
                  <Field key={name} label={label}><input className="input" name={name} inputMode="decimal" defaultValue={(impact?.[key] as string) ?? ""} disabled={!update} /></Field>
                ))}
              </div>
              <Field label="Data source for actual results" hint="Required when actual values are entered — e.g. finance report reference."><input className="input" name="dataSource" maxLength={500} defaultValue={(impact?.data_source as string) ?? ""} disabled={!update} /></Field>
              <p className="text-xs text-muted">
                {impact?.actuals_confirmed_at ? `Actual results confirmed by ${impact.confirmed_name} on ${fmtDate(impact.actuals_confirmed_at as string)}.` : "Actual results not yet confirmed."}
              </p>
              {update && (
                <div className="flex flex-wrap items-center gap-4">
                  <SubmitButton className="btn btn-secondary">Save impact</SubmitButton>
                  {(manage || canApproveAction(u, access)) && <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" name="confirmActuals" className="accent-[#e2242f]" /> Confirm actual results</label>}
                </div>
              )}
            </ActionForm>
          </Section>

          <Section title={`Comments (${comments.length})`}>
            <ul className="space-y-3">
              {comments.map((c) => (
                <li key={String(c.id)} className="text-sm">
                  <p className="text-xs text-muted"><span className="font-medium text-fg-2">{String(c.name)}</span> · {fmtDateTime(c.created_at as string)}</p>
                  <p className="mt-0.5 whitespace-pre-line">{String(c.body)}</p>
                </li>
              ))}
            </ul>
            {(update || canApproveAction(u, access)) && (
              <ActionForm action={addComment} className="mt-4 flex flex-col gap-2">
                {hidden}
                <textarea className="input" name="body" rows={2} required maxLength={4000} placeholder="Add a comment" aria-label="Comment" />
                <div><SubmitButton className="btn btn-secondary btn-sm">Comment</SubmitButton></div>
              </ActionForm>
            )}
          </Section>
        </div>

        <div className="space-y-5">
          <Section title="Details">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted">Responsible</dt><dd>{a.owner_name}</dd>
              <dt className="text-muted">Assigned by</dt><dd>{a.assigned_by_name ?? "—"}</dd>
              {a.suggested_responsible && <><dt className="text-muted">Suggested</dt><dd>{a.suggested_responsible}</dd></>}
              <dt className="text-muted">Department</dt><dd>{a.department ?? "Not yet assigned"}</dd>
              {(x.support_names as string[]).length > 0 && <><dt className="text-muted">Supporting</dt><dd>{(x.support_names as string[]).join(", ")}</dd></>}
              {(x.contributor_names as string[]).length > 0 && <><dt className="text-muted">Contributors</dt><dd>{(x.contributor_names as string[]).join(", ")}</dd></>}
              <dt className="text-muted">Director</dt><dd>{a.director_name ?? "—"}</dd>
              <dt className="text-muted">Start</dt><dd>{fmtDate(a.start_date)}</dd>
              <dt className="text-muted">Target</dt><dd>{a.target_date ? fmtDate(a.target_date) : a.timeline_note ?? "—"}</dd>
              <dt className="text-muted">Objective area</dt><dd>{a.category ? CATEGORY_LABEL[a.category as Category] : "—"}</dd>
              {a.business_impact && <><dt className="text-muted">Impact</dt><dd className="whitespace-pre-line">{a.business_impact}</dd></>}
              {!!x.meeting_id && <><dt className="text-muted">Meeting</dt><dd><Link className="link" href={`/meetings/${x.meeting_id}`}>{String(x.meeting_title)}</Link></dd></>}
              <dt className="text-muted">Last update</dt><dd>{a.last_update_at ? fmtDateTime(a.last_update_at) : "None yet"}</dd>
              {a.completed_at && <><dt className="text-muted">Completed</dt><dd>{fmtDateTime(a.completed_at)}{x.approved_by ? ` · approved by ${x.approved_by}` : ""}</dd></>}
            </dl>
          </Section>

          {canReassignAction(u, access) && !closed && (
            <Section title="Assign / reassign">
              <ActionForm action={reassignAction} className="space-y-2">
                {hidden}
                <select className="input" name="toUserId" required defaultValue="" aria-label="New responsible person">
                  <option value="" disabled>Select responsible person…</option>
                  {lk.users.filter((p) => p.id !== a.owner_id).map((p) => <option key={p.id} value={p.id}>{p.name}{p.department ? ` · ${p.department}` : ""}</option>)}
                </select>
                <input className="input" name="note" maxLength={1000} placeholder="Instruction (optional)" aria-label="Assignment note" />
                <SubmitButton className="btn btn-secondary w-full">Transfer responsibility</SubmitButton>
              </ActionForm>
            </Section>
          )}

          {update && !closed && (
            <Section title="Escalation">
              {a.is_escalated ? (
                <ActionForm action={escalateAction}>
                  {hidden}
                  <input type="hidden" name="resolve" value="1" />
                  <p className="mb-2 text-sm text-fg-2">Escalated {fmtRelative(x.escalated_at as string)}.</p>
                  {(manage || isExecutive(u)) && <SubmitButton className="btn btn-secondary btn-sm">Mark resolved</SubmitButton>}
                </ActionForm>
              ) : (
                <ActionForm action={escalateAction} className="space-y-2">
                  {hidden}
                  <textarea className="input" name="note" rows={2} required maxLength={2000} placeholder="Issue requiring executive decision" aria-label="Escalation reason" />
                  <SubmitButton className="btn btn-danger btn-sm">Escalate to CEO</SubmitButton>
                </ActionForm>
              )}
            </Section>
          )}

          <Section title={`Evidence & attachments (${files.length})`}>
            <ul className="space-y-2">
              {files.map((f) => (
                <li key={String(f.id)} className="flex items-start justify-between gap-2 text-sm">
                  <a href={`/api/attachments/${f.id}`} className="link inline-flex min-w-0 items-start gap-1.5"><Paperclip size={14} className="mt-0.5 shrink-0 text-muted" /><span className="break-all">{String(f.filename)}</span></a>
                  <span className="shrink-0 text-xs text-muted">{Math.ceil(Number(f.size_bytes) / 1024)} KB</span>
                  {update && (f.uploaded_by === u.id || manage) && (
                    <ActionForm action={removeAttachment}>
                      {hidden}
                      <input type="hidden" name="attachmentId" value={String(f.id)} />
                      <SubmitButton className="btn btn-ghost btn-sm" confirm="Remove this file?">Remove</SubmitButton>
                    </ActionForm>
                  )}
                </li>
              ))}
            </ul>
            {update && (
              <ActionForm action={uploadAttachment} className="mt-3 space-y-2">
                {hidden}
                <input className="block w-full text-xs text-fg-2 file:mr-3 file:rounded file:border-0 file:bg-surface-3 file:px-3 file:py-1.5 file:text-fg" type="file" name="file" required aria-label="File" />
                <SubmitButton className="btn btn-secondary btn-sm" pendingText="Uploading…">Upload</SubmitButton>
                <p className="text-xs text-muted">PDF, Office, images, CSV or text · max 10 MB</p>
              </ActionForm>
            )}
          </Section>

          <Section title="Ownership history">
            <ol className="space-y-2 text-sm">
              {assignments.map((h) => (
                <li key={String(h.id)}>
                  <p>{h.from_name ? `${h.from_name} → ` : ""}<span className="font-medium">{String(h.to_name)}</span></p>
                  <p className="text-xs text-muted">{fmtDateTime(h.created_at as string)}{h.by_name ? ` · by ${h.by_name}` : ""}{h.note ? ` · ${h.note}` : ""}</p>
                </li>
              ))}
            </ol>
          </Section>

          {manage && (
            <details className="card">
              <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">Edit action plan</summary>
              <div className="border-t border-line p-4">
                <ActionForm action={editAction} resetOnSuccess={false}>
                  {hidden}
                  <ActionFields
                    lk={lk}
                    canConfidential={canSeeConfidential(u)}
                    d={{
                      pointTask: a.point_task,
                      orgIds: x.org_ids as number[],
                      departmentId: a.department_id,
                      supportDeptIds: x.support_ids as number[],
                      contributorIds: x.contributor_ids as string[],
                      startDate: a.start_date,
                      targetDate: a.target_date,
                      priority: a.priority,
                      category: a.category,
                      businessImpact: a.business_impact,
                      timelineNote: a.timeline_note,
                      isConfidential: !!x.is_confidential,
                    }}
                  />
                  <div className="mt-4"><SubmitButton>Save changes</SubmitButton></div>
                </ActionForm>
              </div>
            </details>
          )}

          {manage && closed && (
            <Section title="Reopen">
              <ActionForm action={reopenAction} className="space-y-2">
                {hidden}
                <input className="input" name="note" required maxLength={1000} placeholder="Reason for reopening" aria-label="Reason" />
                <SubmitButton className="btn btn-secondary btn-sm">Reopen action</SubmitButton>
              </ActionForm>
            </Section>
          )}

          {canDeleteAction(u) && (
            <details className="card">
              <summary className="cursor-pointer px-4 py-3 text-sm text-[#ff7b82]">Delete action plan</summary>
              <ActionForm action={deleteAction} className="space-y-2 border-t border-line p-4">
                {hidden}
                <input className="input" name="reason" required maxLength={500} placeholder="Reason (kept in the audit log)" aria-label="Deletion reason" />
                <SubmitButton className="btn btn-danger btn-sm" confirm="Delete this action plan? It will be hidden but kept for audit retention.">Delete</SubmitButton>
              </ActionForm>
            </details>
          )}
        </div>
      </div>

      <Section title="Activity history">
        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Progress updates</h3>
            {updates.length === 0 ? <p className="text-sm text-muted">No updates posted.</p> : (
              <ol className="space-y-3">
                {updates.map((h) => (
                  <li key={String(h.id)} className="text-sm">
                    <p className="text-xs text-muted"><span className="font-medium text-fg-2">{String(h.name)}</span> · {fmtDateTime(h.created_at as string)}{h.progress != null ? ` · ${h.progress}%` : ""}{h.is_blocker ? " · blocker" : ""}</p>
                    <p className="whitespace-pre-line">{String(h.note)}</p>
                  </li>
                ))}
              </ol>
            )}
          </div>
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Audit trail</h3>
            <ol className="space-y-1.5 text-xs">
              {history.map((h, i) => (
                <li key={i} className="text-fg-2"><span className="text-muted">{fmtDateTime(h.created_at as string)}</span> · {(h.name as string) ?? "System"} · {String(h.action).replace(/_/g, " ")}</li>
              ))}
            </ol>
          </div>
        </div>
      </Section>
    </div>
  );
}
