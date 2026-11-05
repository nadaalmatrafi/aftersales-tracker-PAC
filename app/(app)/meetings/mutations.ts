"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { actionUser, canManageMeetings, AuthError } from "@/lib/auth";
import { audit, diff } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { calendarConfigured, syncMeetingToCalendar } from "@/lib/calendar";
import { riyadhLocalToDate, fmtDateTime } from "@/lib/dates";
import { all, fail, int, ok, str, uuid, type FormState } from "@/lib/form-state";

function parse(fd: FormData) {
  const at = str(fd, "meetingAt", 20);
  const duration = Number(fd.get("durationMinutes") || 60);
  return {
    title: str(fd, "title", 200),
    meetingAt: at && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(at) ? riyadhLocalToDate(at) : null,
    durationMinutes: Number.isInteger(duration) && duration >= 15 && duration <= 480 ? duration : 60,
    location: str(fd, "location", 300),
    meetingLink: (() => {
      const l = str(fd, "meetingLink", 500);
      return l && /^https:\/\//i.test(l) ? l : null;
    })(),
    agenda: str(fd, "agenda", 8000),
    isConfidential: fd.get("isConfidential") === "on",
    orgIds: all(fd, "orgIds").map(Number).filter((n) => Number.isInteger(n) && n > 0),
    attendeeIds: [...new Set(all(fd, "attendeeIds").filter((v) => /^[0-9a-f-]{36}$/i.test(v)))],
  };
}

async function calendarSync(meetingId: string) {
  if (!calendarConfigured()) return null;
  const [m] = await db.select().from(schema.meetings).where(eq(schema.meetings.id, meetingId));
  const attendees = await db
    .select({ email: schema.users.email, name: schema.users.name })
    .from(schema.meetingAttendees)
    .innerJoin(schema.users, eq(schema.users.id, schema.meetingAttendees.userId))
    .where(eq(schema.meetingAttendees.meetingId, meetingId));
  const res = await syncMeetingToCalendar({
    id: m.id,
    title: m.title,
    start: m.meetingAt,
    durationMinutes: m.durationMinutes,
    agenda: m.agenda,
    location: m.location,
    meetingLink: m.meetingLink,
    attendees,
    cancelled: m.status === "cancelled",
  });
  if (res.ok) await db.update(schema.meetings).set({ calendarEventId: res.eventId, calendarSyncedAt: new Date() }).where(eq(schema.meetings.id, meetingId));
  return res;
}

async function notifyAttendees(meetingId: string, actorId: string, kind: "created" | "updated" | "cancelled") {
  const [m] = await db.select().from(schema.meetings).where(eq(schema.meetings.id, meetingId));
  const att = await db.select({ id: schema.meetingAttendees.userId }).from(schema.meetingAttendees).where(eq(schema.meetingAttendees.meetingId, meetingId));
  await notify({
    userIds: att.map((a) => a.id),
    excludeUserId: actorId,
    type: "meeting",
    title: kind === "cancelled" ? `Meeting cancelled: ${m.title}` : `${kind === "created" ? "Meeting scheduled" : "Meeting updated"}: ${m.title}`,
    body: `${fmtDateTime(m.meetingAt)} (Riyadh time)${m.location ? `\nLocation: ${m.location}` : ""}${m.meetingLink ? `\nLink: ${m.meetingLink}` : ""}${m.agenda ? `\n\nAgenda:\n${m.agenda}` : ""}`,
    link: `/meetings/${meetingId}`,
    dedupeKey: `meeting:${kind}:${meetingId}:${m.meetingAt.toISOString()}`,
  });
}

export async function createMeeting(_: FormState, fd: FormData): Promise<FormState> {
  let id: string;
  try {
    const u = await actionUser();
    if (!canManageMeetings(u)) return fail("You are not authorized to create meetings.");
    const p = parse(fd);
    if (!p.title) return fail("Meeting title is required.");
    if (!p.meetingAt) return fail("Choose the meeting date and time.");
    if (!p.orgIds.length) return fail("Select the participating organizations.");
    id = await db.transaction(async (tx) => {
      const [m] = await tx
        .insert(schema.meetings)
        .values({ title: p.title!, meetingAt: p.meetingAt!, durationMinutes: p.durationMinutes, location: p.location, meetingLink: p.meetingLink, agenda: p.agenda, isConfidential: p.isConfidential, createdBy: u.id })
        .returning({ id: schema.meetings.id });
      await tx.insert(schema.meetingOrganizations).values(p.orgIds.map((o) => ({ meetingId: m.id, organizationId: o })));
      if (p.attendeeIds.length) await tx.insert(schema.meetingAttendees).values(p.attendeeIds.map((x) => ({ meetingId: m.id, userId: x })));
      await audit(u.id, "meeting", m.id, "create", { ...p, meetingAt: p.meetingAt!.toISOString() }, tx);
      return m.id;
    });
    if (fd.get("addToCalendar") === "on") await calendarSync(id);
    await notifyAttendees(id, u.id, "created");
  } catch (e) {
    if (e instanceof AuthError) return fail(e.message);
    console.error(e);
    return fail("The meeting could not be saved.");
  }
  revalidatePath("/meetings");
  redirect(`/meetings/${id}`);
}

export async function updateMeeting(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const u = await actionUser();
    if (!canManageMeetings(u)) return fail("You are not authorized to edit meetings.");
    const id = uuid(fd, "meetingId");
    if (!id) return fail("Invalid meeting.");
    const p = parse(fd);
    if (!p.title || !p.meetingAt) return fail("Title, date and time are required.");
    if (!p.orgIds.length) return fail("Select the participating organizations.");
    const [before] = await db.select().from(schema.meetings).where(eq(schema.meetings.id, id));
    if (!before) return fail("Meeting not found.");
    const patch = { title: p.title, meetingAt: p.meetingAt, durationMinutes: p.durationMinutes, location: p.location, meetingLink: p.meetingLink, agenda: p.agenda, isConfidential: p.isConfidential };
    const changes = diff(before as unknown as Record<string, unknown>, patch);
    await db.transaction(async (tx) => {
      await tx.update(schema.meetings).set(patch).where(eq(schema.meetings.id, id));
      await tx.delete(schema.meetingOrganizations).where(eq(schema.meetingOrganizations.meetingId, id));
      await tx.insert(schema.meetingOrganizations).values(p.orgIds.map((o) => ({ meetingId: id, organizationId: o })));
      const existing = (await tx.select({ id: schema.meetingAttendees.userId }).from(schema.meetingAttendees).where(eq(schema.meetingAttendees.meetingId, id))).map((r) => r.id);
      const remove = existing.filter((x) => !p.attendeeIds.includes(x));
      const add = p.attendeeIds.filter((x) => !existing.includes(x));
      if (remove.length) await tx.delete(schema.meetingAttendees).where(and(eq(schema.meetingAttendees.meetingId, id), inArray(schema.meetingAttendees.userId, remove)));
      if (add.length) await tx.insert(schema.meetingAttendees).values(add.map((x) => ({ meetingId: id, userId: x })));
      await audit(u.id, "meeting", id, "edit", { ...changes, attendeesAdded: add, attendeesRemoved: remove }, tx);
    });
    if (before.calendarEventId) await calendarSync(id);
    if (changes.meetingAt || changes.location || changes.meetingLink) await notifyAttendees(id, u.id, "updated");
    revalidatePath(`/meetings/${id}`);
    return ok("Meeting updated.");
  } catch (e) {
    console.error(e);
    return fail("The meeting could not be updated.");
  }
}

export async function setMeetingStatus(_: FormState, fd: FormData): Promise<FormState> {
  const u = await actionUser();
  if (!canManageMeetings(u)) return fail("Not authorized.");
  const id = uuid(fd, "meetingId");
  const status = str(fd, "status");
  if (!id || !["scheduled", "held", "cancelled"].includes(status ?? "")) return fail("Invalid request.");
  const summary = str(fd, "summary", 8000);
  await db.update(schema.meetings).set({ status: status as "scheduled" | "held" | "cancelled", ...(summary != null ? { summary } : {}) }).where(eq(schema.meetings.id, id));
  await audit(u.id, "meeting", id, `status_${status}`, { summary: summary ? "updated" : undefined });
  if (status === "cancelled") {
    const [m] = await db.select({ ev: schema.meetings.calendarEventId }).from(schema.meetings).where(eq(schema.meetings.id, id));
    if (m.ev) await calendarSync(id);
    await notifyAttendees(id, u.id, "cancelled");
  }
  revalidatePath(`/meetings/${id}`);
  revalidatePath("/meetings");
  return ok(status === "held" ? "Meeting minutes saved." : "Meeting status updated.");
}

export async function saveAttendance(_: FormState, fd: FormData): Promise<FormState> {
  const u = await actionUser();
  if (!canManageMeetings(u)) return fail("Not authorized.");
  const id = uuid(fd, "meetingId");
  if (!id) return fail("Invalid meeting.");
  const present = new Set(all(fd, "present"));
  const att = await db.select({ id: schema.meetingAttendees.userId }).from(schema.meetingAttendees).where(eq(schema.meetingAttendees.meetingId, id));
  for (const a of att)
    await db.update(schema.meetingAttendees).set({ attended: present.has(a.id) }).where(and(eq(schema.meetingAttendees.meetingId, id), eq(schema.meetingAttendees.userId, a.id)));
  await audit(u.id, "meeting", id, "attendance", { present: [...present] });
  revalidatePath(`/meetings/${id}`);
  return ok("Attendance saved.");
}

export async function addDecision(_: FormState, fd: FormData): Promise<FormState> {
  const u = await actionUser();
  if (!canManageMeetings(u)) return fail("Not authorized to record decisions.");
  const id = uuid(fd, "meetingId");
  const decision = str(fd, "decision", 4000);
  if (!id || !decision) return fail("Write the decision.");
  const [d] = await db.insert(schema.meetingDecisions).values({ meetingId: id, decision, requiresApproval: fd.get("requiresApproval") === "on", createdBy: u.id }).returning({ id: schema.meetingDecisions.id });
  await audit(u.id, "meeting", id, "decision_add", { decisionId: d.id, decision });
  revalidatePath(`/meetings/${id}`);
  return ok("Decision recorded.");
}

export async function syncCalendarNow(_: FormState, fd: FormData): Promise<FormState> {
  const u = await actionUser();
  if (!canManageMeetings(u)) return fail("Not authorized.");
  const id = uuid(fd, "meetingId");
  if (!id) return fail("Invalid meeting.");
  if (!calendarConfigured()) return fail("Google Calendar is not configured. Download the .ics invitation instead.");
  const res = await calendarSync(id);
  await audit(u.id, "meeting", id, "calendar_sync", { ok: res?.ok });
  revalidatePath(`/meetings/${id}`);
  return res?.ok ? ok("Calendar event created / updated.") : fail(res && !res.ok ? res.error : "Calendar sync failed.");
}

export async function deleteDecision(_: FormState, fd: FormData): Promise<FormState> {
  const u = await actionUser();
  if (!canManageMeetings(u)) return fail("Not authorized.");
  const id = int(fd, "decisionId");
  if (!id) return fail("Invalid decision.");
  const [d] = await db.select().from(schema.meetingDecisions).where(eq(schema.meetingDecisions.id, id));
  if (!d) return fail("Not found.");
  if (d.actionId) return fail("This decision already generated an action plan and is kept for traceability.");
  await db.delete(schema.meetingDecisions).where(eq(schema.meetingDecisions.id, id));
  await audit(u.id, "meeting", d.meetingId, "decision_remove", { decision: d.decision });
  revalidatePath(`/meetings/${d.meetingId}`);
  void sql;
  return ok("Decision removed.");
}
