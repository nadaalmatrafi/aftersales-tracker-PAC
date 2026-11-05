import "server-only";
import crypto from "node:crypto";

export function calendarConfigured() {
  return !!(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY && process.env.GOOGLE_CALENDAR_ID);
}

export type CalendarMeeting = {
  id: string;
  title: string;
  start: Date;
  durationMinutes: number;
  agenda: string | null;
  location: string | null;
  meetingLink: string | null;
  attendees: { email: string; name: string }[];
  cancelled?: boolean;
};

/** Deterministic Google event id (base32hex alphabet a–v, 0–9) — retries can never create duplicates. */
export function eventIdFor(meetingId: string) {
  return `bpmeeting${meetingId.replace(/-/g, "").toLowerCase()}`;
}

async function accessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const claims: Record<string, unknown> = {
    iss: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    scope: "https://www.googleapis.com/auth/calendar.events",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  if (process.env.GOOGLE_IMPERSONATE_USER) claims.sub = process.env.GOOGLE_IMPERSONATE_USER;
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64(claims)}`;
  const key = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY!.replace(/\\n/g, "\n");
  const signature = crypto.sign("RSA-SHA256", Buffer.from(unsigned), key).toString("base64url");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Google token request failed (${res.status})`);
  return ((await res.json()) as { access_token: string }).access_token;
}

/** Creates or updates the calendar event for a meeting (upsert on deterministic id). */
export async function syncMeetingToCalendar(m: CalendarMeeting): Promise<{ ok: true; eventId: string } | { ok: false; error: string }> {
  if (!calendarConfigured()) return { ok: false, error: "Google Calendar is not configured." };
  try {
    const token = await accessToken();
    const cal = encodeURIComponent(process.env.GOOGLE_CALENDAR_ID!);
    const id = eventIdFor(m.id);
    const end = new Date(m.start.getTime() + m.durationMinutes * 60_000);
    const body = {
      id,
      summary: m.title,
      description: [m.agenda, m.meetingLink ? `Meeting link: ${m.meetingLink}` : null].filter(Boolean).join("\n\n"),
      location: m.location || m.meetingLink || undefined,
      start: { dateTime: m.start.toISOString(), timeZone: "Asia/Riyadh" },
      end: { dateTime: end.toISOString(), timeZone: "Asia/Riyadh" },
      attendees: m.attendees.map((a) => ({ email: a.email, displayName: a.name })),
      status: m.cancelled ? "cancelled" : "confirmed",
    };
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    const base = `https://www.googleapis.com/calendar/v3/calendars/${cal}/events`;
    let res = await fetch(`${base}?sendUpdates=all`, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
    if (res.status === 409) {
      res = await fetch(`${base}/${id}?sendUpdates=all`, { method: "PUT", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
    }
    if (!res.ok) return { ok: false, error: `Google Calendar responded ${res.status}` };
    return { ok: true, eventId: id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Calendar sync failed" };
  }
}

const icsEsc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const icsDate = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

export function meetingIcs(m: CalendarMeeting) {
  const end = new Date(m.start.getTime() + m.durationMinutes * 60_000);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Business Performance//PAC PCVC DEX//EN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${eventIdFor(m.id)}@business-performance`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(m.start)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${icsEsc(m.title)}`,
    m.agenda || m.meetingLink ? `DESCRIPTION:${icsEsc([m.agenda, m.meetingLink].filter(Boolean).join("\n\n"))}` : null,
    m.location || m.meetingLink ? `LOCATION:${icsEsc(m.location || m.meetingLink || "")}` : null,
    ...m.attendees.map((a) => `ATTENDEE;CN=${icsEsc(a.name)};ROLE=REQ-PARTICIPANT:mailto:${a.email}`),
    m.cancelled ? "STATUS:CANCELLED" : "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);
  return lines.join("\r\n");
}
