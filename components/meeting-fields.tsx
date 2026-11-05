import type { Lookup } from "@/lib/queries";
import { Field } from "./ui";

export type MeetingDefaults = { title?: string; meetingAt?: string; durationMinutes?: number; location?: string | null; meetingLink?: string | null; agenda?: string | null; orgIds?: number[]; attendeeIds?: string[]; isConfidential?: boolean };

export function MeetingFields({ lk, d = {}, showCalendar }: { lk: Lookup; d?: MeetingDefaults; showCalendar?: boolean }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field label="Title" className="md:col-span-2"><input className="input" name="title" required maxLength={200} defaultValue={d.title ?? "Weekly CEO Meeting"} /></Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Date & time (Riyadh)"><input className="input" type="datetime-local" name="meetingAt" required defaultValue={d.meetingAt} /></Field>
        <Field label="Duration (min)"><input className="input" type="number" name="durationMinutes" min={15} max={480} step={15} defaultValue={d.durationMinutes ?? 60} /></Field>
      </div>
      <Field label="Location"><input className="input" name="location" maxLength={300} defaultValue={d.location ?? ""} /></Field>
      <Field label="Meeting link (https)" className="md:col-span-2"><input className="input" name="meetingLink" type="url" pattern="https://.*" maxLength={500} defaultValue={d.meetingLink ?? ""} /></Field>
      <fieldset>
        <legend className="label">Participating organizations</legend>
        <div className="flex flex-wrap gap-4">
          {lk.orgs.map((o) => (
            <label key={o.id} className="inline-flex items-center gap-2 text-sm"><input type="checkbox" name="orgIds" value={o.id} defaultChecked={d.orgIds ? d.orgIds.includes(o.id) : true} className="accent-[#e2242f]" />{o.code}</label>
          ))}
        </div>
      </fieldset>
      <Field label="Attendees" hint="Hold Ctrl / Cmd to select several.">
        <select className="input h-32" name="attendeeIds" multiple defaultValue={d.attendeeIds ?? []}>
          {lk.users.map((u) => <option key={u.id} value={u.id}>{u.name}{u.department ? ` · ${u.department}` : ""}</option>)}
        </select>
      </Field>
      <Field label="Agenda" className="md:col-span-2"><textarea className="input" name="agenda" rows={4} maxLength={8000} defaultValue={d.agenda ?? ""} /></Field>
      <div className="flex flex-wrap gap-6 md:col-span-2">
        <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" name="isConfidential" defaultChecked={d.isConfidential} className="accent-[#e2242f]" /> Confidential</label>
        {showCalendar && <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" name="addToCalendar" defaultChecked className="accent-[#e2242f]" /> Add to company Google Calendar</label>}
      </div>
    </div>
  );
}
