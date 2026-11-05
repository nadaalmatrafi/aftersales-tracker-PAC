import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireUser, canManageMeetings, canCreateActions, canExport } from "@/lib/auth";
import { meetingVisibility } from "@/lib/access";
import { listActions, lookups, type ActionRow } from "@/lib/queries";
import { calendarConfigured } from "@/lib/calendar";
import { dateToRiyadhLocal, fmtDateTime } from "@/lib/dates";
import { ActionForm, SubmitButton } from "@/components/forms";
import { MeetingFields } from "@/components/meeting-fields";
import { ActionTable } from "@/components/action-table";
import { Badge, EmptyState, Field, PageHeader, Section } from "@/components/ui";
import { addDecision, deleteDecision, saveAttendance, setMeetingStatus, syncCalendarNow, updateMeeting } from "../mutations";

export const metadata = { title: "Meeting" };

/** Follow-up sets for a meeting, scoped to its organizations. Unfinished actions carry forward until closed. */
function followUp(rows: ActionRow[], m: { at: Date; orgs: string[] }, prevAt: Date | null, fromIds: Set<number>) {
  const inScope = rows.filter((a) => a.org_codes.some((c) => m.orgs.includes(c)));
  const windowEnd = Math.min(Date.now(), m.at.getTime());
  const isOpen = (a: ActionRow) => a.status !== "completed" && a.status !== "cancelled";
  const before = (a: ActionRow) => new Date(a.created_at).getTime() < m.at.getTime();
  return {
    carried: inScope.filter((a) => before(a) && !fromIds.has(a.id) && isOpen(a)),
    completed: inScope.filter((a) => a.status === "completed" && a.completed_at && new Date(a.completed_at).getTime() <= windowEnd && (!prevAt || new Date(a.completed_at).getTime() > prevAt.getTime())),
    overdue: inScope.filter((a) => a.effective_status === "overdue"),
    escalated: inScope.filter((a) => isOpen(a) && a.is_escalated),
    approvals: inScope.filter((a) => a.status === "pending_approval"),
  };
}

export default async function MeetingPage({ params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const r = await db.execute(sql`SELECT m.*, cu.name AS creator,
      COALESCE((SELECT array_agg(o.code ORDER BY o.id) FROM meeting_organizations mo JOIN organizations o ON o.id = mo.organization_id WHERE mo.meeting_id = m.id), '{}') AS orgs,
      COALESCE((SELECT array_agg(mo.organization_id) FROM meeting_organizations mo WHERE mo.meeting_id = m.id), '{}') AS org_ids
    FROM meetings m LEFT JOIN users cu ON cu.id = m.created_by WHERE m.id = ${id} AND ${meetingVisibility(u)}`);
  const m = r.rows[0] as Record<string, unknown> | undefined;
  if (!m) notFound();
  const at = new Date(m.meeting_at as string);
  const orgs = m.orgs as string[];
  const [attendees, decisions, prev, all, lk, fromMeeting] = await Promise.all([
    db.execute(sql`SELECT u.id, u.name, u.title, d.name AS dept, a.attended FROM meeting_attendees a JOIN users u ON u.id = a.user_id LEFT JOIN departments d ON d.id = u.department_id WHERE a.meeting_id = ${id} ORDER BY u.name`),
    db.execute(sql`SELECT d.*, a.code, a.id AS aid FROM meeting_decisions d LEFT JOIN action_plans a ON a.id = d.action_id AND a.deleted_at IS NULL WHERE d.meeting_id = ${id} ORDER BY d.created_at`),
    db.execute(sql`SELECT m2.id, m2.title, m2.meeting_at FROM meetings m2 WHERE m2.meeting_at < ${at.toISOString()}::timestamptz AND m2.status <> 'cancelled' AND m2.id <> ${id}
                   AND EXISTS (SELECT 1 FROM meeting_organizations a JOIN meeting_organizations b ON a.organization_id = b.organization_id WHERE a.meeting_id = m2.id AND b.meeting_id = ${id})
                   ORDER BY m2.meeting_at DESC LIMIT 1`),
    listActions(u, {}),
    lookups(),
    listActions(u, { meeting: id }),
  ]);
  const prevMeeting = prev.rows[0] as { id: string; title: string; meeting_at: string } | undefined;
  const fromIds = new Set(fromMeeting.map((a) => a.id));
  const fu = followUp(all, { at, orgs }, prevMeeting ? new Date(prevMeeting.meeting_at) : null, fromIds);
  const manage = canManageMeetings(u);
  const hidden = <input type="hidden" name="meetingId" value={id} />;
  const att = attendees.rows as { id: string; name: string; title: string | null; dept: string | null; attended: boolean | null }[];
  const dec = decisions.rows as { id: number; decision: string; requires_approval: boolean; code: string | null; aid: number | null }[];
  const pendingDecisions = dec.filter((d) => d.requires_approval && !d.aid);

  return (
    <div className="space-y-5">
      <Link href="/meetings" className="text-xs text-muted hover:text-fg">← Meetings</Link>
      <PageHeader
        title={String(m.title)}
        subtitle={<>{fmtDateTime(at)} · {m.duration_minutes as number} min · {orgs.join(", ")}{m.location ? ` · ${m.location}` : ""}{prevMeeting ? <> · previous: <Link className="link" href={`/meetings/${prevMeeting.id}`}>{fmtDateTime(prevMeeting.meeting_at)}</Link></> : null}</>}
        actions={
          <>
            <Badge tone={m.status === "held" ? "ok" : m.status === "cancelled" ? "neutral" : "warn"}>{String(m.status)}</Badge>
            {!!m.meeting_link && <a className="btn btn-secondary" href={String(m.meeting_link)} target="_blank" rel="noopener noreferrer">Join link</a>}
            <a className="btn btn-secondary" href={`/api/meetings/${id}/ics`}>.ics invite</a>
            {canExport(u) && <a className="btn btn-secondary" href={`/api/reports/meeting?meeting=${id}&format=pdf`}>Follow-up PDF</a>}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {([["Carried forward", fu.carried.length], ["Completed since last meeting", fu.completed.length], ["Overdue", fu.overdue.length], ["Escalated", fu.escalated.length], ["Approvals required", fu.approvals.length + pendingDecisions.length]] as const).map(([l, v]) => (
          <div key={l} className="card card-pad"><p className="text-[11px] uppercase tracking-wider text-muted">{l}</p><p className="mt-1 text-2xl font-semibold tabular-nums">{v}</p></div>
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Section title="Decisions">
            {dec.length === 0 && <p className="mb-3 text-sm text-muted">No decisions recorded.</p>}
            <ul className="space-y-2">
              {dec.map((d) => (
                <li key={d.id} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-line p-3">
                  <div className="min-w-0 flex-1">
                    <p className="whitespace-pre-line text-sm">{d.decision}</p>
                    <div className="mt-1 flex gap-1.5">{d.requires_approval && <Badge tone="warn">Requires management approval</Badge>}{d.aid && <Link href={`/actions/${d.aid}`}><Badge tone="info">Action {d.code}</Badge></Link>}</div>
                  </div>
                  <div className="flex gap-1">
                    {!d.aid && canCreateActions(u) && <Link className="btn btn-secondary btn-sm" href={`/actions/new?meeting=${id}&decision=${d.id}`}>Create action</Link>}
                    {!d.aid && manage && (
                      <ActionForm action={deleteDecision}><input type="hidden" name="decisionId" value={d.id} /><SubmitButton className="btn btn-ghost btn-sm" confirm="Remove this decision?">Remove</SubmitButton></ActionForm>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {manage && (
              <ActionForm action={addDecision} className="mt-4 space-y-2 border-t border-line pt-4">
                {hidden}
                <textarea className="input" name="decision" rows={2} required maxLength={4000} placeholder="Record a decision" aria-label="Decision" />
                <div className="flex flex-wrap items-center gap-4">
                  <SubmitButton className="btn btn-secondary btn-sm">Add decision</SubmitButton>
                  <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" name="requiresApproval" className="accent-[#e2242f]" /> Requires management approval</label>
                </div>
              </ActionForm>
            )}
          </Section>

          <Section title={`New actions from this meeting (${fromMeeting.length})`} actions={canCreateActions(u) ? <Link href={`/actions/new?meeting=${id}`} className="btn btn-secondary btn-sm">New action</Link> : undefined}>
            <div className="-m-4"><ActionTable rows={fromMeeting} compact emptyText="No actions created from this meeting yet." /></div>
          </Section>
          <Section title={`Carried forward — unfinished actions (${fu.carried.length})`}>
            <div className="-m-4"><ActionTable rows={fu.carried} compact emptyText="No unfinished actions carried into this meeting." /></div>
          </Section>
          <Section title={`Completed since previous meeting (${fu.completed.length})`}>
            <div className="-m-4"><ActionTable rows={fu.completed} compact emptyText="No actions completed in this period." /></div>
          </Section>
          {(fu.escalated.length > 0 || fu.approvals.length > 0) && (
            <Section title="Escalations & pending approvals">
              <div className="-m-4"><ActionTable rows={[...new Map([...fu.escalated, ...fu.approvals].map((a) => [a.id, a])).values()]} compact /></div>
            </Section>
          )}
        </div>

        <div className="space-y-5">
          {!!m.agenda && <Section title="Agenda"><p className="whitespace-pre-line text-sm text-fg-2">{String(m.agenda)}</p></Section>}
          <Section title={`Attendees (${att.length})`}>
            {att.length === 0 ? <p className="text-sm text-muted">No attendees assigned.</p> : manage ? (
              <ActionForm action={saveAttendance} resetOnSuccess={false}>
                {hidden}
                <ul className="space-y-1.5">{att.map((a) => (
                  <li key={a.id}><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="present" value={a.id} defaultChecked={a.attended === true} className="accent-[#e2242f]" />{a.name}<span className="text-xs text-muted">{a.dept ?? a.title ?? ""}</span></label></li>
                ))}</ul>
                <div className="mt-3"><SubmitButton className="btn btn-secondary btn-sm">Save attendance</SubmitButton></div>
              </ActionForm>
            ) : (
              <ul className="space-y-1 text-sm">{att.map((a) => <li key={a.id}>{a.name} <span className="text-xs text-muted">{a.attended === true ? "· attended" : a.attended === false ? "· absent" : ""}</span></li>)}</ul>
            )}
          </Section>
          <Section title="Calendar">
            <p className="mb-2 text-sm text-fg-2">{m.calendar_event_id ? `Synced to Google Calendar ${m.calendar_synced_at ? fmtDateTime(m.calendar_synced_at as string) : ""}.` : calendarConfigured() ? "Not yet on the company calendar." : "Google Calendar is not connected. Use the .ics invite."}</p>
            {manage && calendarConfigured() && (
              <ActionForm action={syncCalendarNow}>{hidden}<SubmitButton className="btn btn-secondary btn-sm">{m.calendar_event_id ? "Update calendar event" : "Add to calendar"}</SubmitButton></ActionForm>
            )}
          </Section>
          {manage && (
            <Section title="Minutes & status">
              <ActionForm action={setMeetingStatus} resetOnSuccess={false} className="space-y-2">
                {hidden}
                <Field label="Summary / minutes"><textarea className="input" name="summary" rows={4} maxLength={8000} defaultValue={(m.summary as string) ?? ""} /></Field>
                <div className="flex flex-wrap gap-2">
                  <button name="status" value="held" className="btn btn-primary btn-sm">Save as held</button>
                  <button name="status" value="scheduled" className="btn btn-secondary btn-sm">Keep scheduled</button>
                  <button name="status" value="cancelled" className="btn btn-danger btn-sm">Cancel meeting</button>
                </div>
              </ActionForm>
            </Section>
          )}
          {!manage && !!m.summary && <Section title="Summary"><p className="whitespace-pre-line text-sm text-fg-2">{String(m.summary)}</p></Section>}
          {manage && (
            <details className="card">
              <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">Edit meeting</summary>
              <div className="border-t border-line p-4">
                <ActionForm action={updateMeeting} resetOnSuccess={false}>
                  {hidden}
                  <MeetingFields lk={lk} d={{ title: String(m.title), meetingAt: dateToRiyadhLocal(at), durationMinutes: m.duration_minutes as number, location: m.location as string, meetingLink: m.meeting_link as string, agenda: m.agenda as string, orgIds: m.org_ids as number[], attendeeIds: att.map((a) => a.id), isConfidential: !!m.is_confidential }} />
                  <div className="mt-4"><SubmitButton>Save meeting</SubmitButton></div>
                </ActionForm>
              </div>
            </details>
          )}
          {!att.length && !dec.length && <EmptyState title="Add attendees and record decisions to build the follow-up." />}
        </div>
      </div>
    </div>
  );
}
