import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireUser, canManageMeetings } from "@/lib/auth";
import { meetingVisibility } from "@/lib/access";
import { lookups } from "@/lib/queries";
import { calendarConfigured } from "@/lib/calendar";
import { fmtDateTime } from "@/lib/dates";
import { ActionForm, SubmitButton } from "@/components/forms";
import { MeetingFields } from "@/components/meeting-fields";
import { Badge, EmptyState, PageHeader, Section } from "@/components/ui";
import { createMeeting } from "./mutations";

export const metadata = { title: "CEO Meetings" };

export default async function MeetingsPage() {
  const u = await requireUser();
  const [res, lk] = await Promise.all([
    db.execute(sql`SELECT m.id, m.title, m.meeting_at, (m.meeting_at >= now()) AS is_future, m.status::text, m.location, m.calendar_event_id,
                     COALESCE((SELECT array_agg(o.code ORDER BY o.id) FROM meeting_organizations mo JOIN organizations o ON o.id = mo.organization_id WHERE mo.meeting_id = m.id), '{}') AS orgs,
                     (SELECT count(*)::int FROM meeting_attendees WHERE meeting_id = m.id) AS attendees,
                     (SELECT count(*)::int FROM meeting_decisions WHERE meeting_id = m.id) AS decisions,
                     (SELECT count(*)::int FROM action_plans a WHERE a.meeting_id = m.id AND a.deleted_at IS NULL) AS actions
                   FROM meetings m WHERE ${meetingVisibility(u)} ORDER BY m.meeting_at DESC LIMIT 200`),
    lookups(),
  ]);
  const rows = res.rows as { id: string; title: string; meeting_at: string; is_future: boolean; status: string; location: string | null; calendar_event_id: string | null; orgs: string[]; attendees: number; decisions: number; actions: number }[];
  const upcoming = rows.filter((m) => m.is_future && m.status === "scheduled").reverse();
  const past = rows.filter((m) => !upcoming.includes(m));
  const list = (items: typeof rows) => (
    <ul className="divide-y divide-line">
      {items.map((m) => (
        <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
          <div>
            <Link href={`/meetings/${m.id}`} className="link font-medium">{m.title}</Link>
            <p className="text-xs text-muted">{fmtDateTime(m.meeting_at)} · {m.orgs.join(", ")} · {m.attendees} attendees · {m.decisions} decisions · {m.actions} actions</p>
          </div>
          <div className="flex gap-1.5">
            {m.calendar_event_id && <Badge tone="info">On calendar</Badge>}
            <Badge tone={m.status === "held" ? "ok" : m.status === "cancelled" ? "neutral" : "warn"}>{m.status === "held" ? "Held" : m.status === "cancelled" ? "Cancelled" : "Scheduled"}</Badge>
          </div>
        </li>
      ))}
    </ul>
  );
  return (
    <>
      <PageHeader title="Weekly CEO Meetings" subtitle="Agenda, decisions and automatic follow-up of unfinished actions." />
      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Section title="Upcoming">{upcoming.length ? list(upcoming) : <EmptyState title="No upcoming meetings scheduled." />}</Section>
          <Section title="Previous">{past.length ? list(past) : <EmptyState title="No previous meetings." />}</Section>
        </div>
        {canManageMeetings(u) && (
          <Section title="Schedule a meeting">
            <ActionForm action={createMeeting} resetOnSuccess={false}>
              <MeetingFields lk={lk} showCalendar={calendarConfigured()} />
              {!calendarConfigured() && <p className="mt-3 text-xs text-muted">Google Calendar is not connected — an .ics invitation will be available on the meeting page.</p>}
              <div className="mt-4"><SubmitButton>Create meeting</SubmitButton></div>
            </ActionForm>
          </Section>
        )}
      </div>
    </>
  );
}
