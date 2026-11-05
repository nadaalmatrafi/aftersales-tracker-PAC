import { TIME_ZONE } from "./constants";

/** Today's calendar date (YYYY-MM-DD) in the business time zone. */
export function todayISO(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(fromISO: string, toISO: string): number {
  return Math.round((Date.parse(`${toISO}T00:00:00Z`) - Date.parse(`${fromISO}T00:00:00Z`)) / 86_400_000);
}

export function fmtDate(v: string | Date | null | undefined): string {
  if (!v) return "—";
  const d = typeof v === "string" ? new Date(v.length === 10 ? `${v}T00:00:00Z` : v) : v;
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: typeof v === "string" && v.length === 10 ? "UTC" : TIME_ZONE,
  }).format(d);
}

export function fmtDateTime(v: string | Date | null | undefined): string {
  if (!v) return "—";
  const d = typeof v === "string" ? new Date(v) : v;
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TIME_ZONE,
  }).format(d);
}

export function fmtRelative(v: string | Date | null | undefined, now = new Date()): string {
  if (!v) return "never";
  const d = typeof v === "string" ? new Date(v) : v;
  const days = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

/** Converts a datetime-local value entered in Riyadh time to a Date. */
export function riyadhLocalToDate(local: string): Date {
  // Riyadh has no DST: fixed UTC+03:00.
  return new Date(`${local.length === 16 ? `${local}:00` : local}+03:00`);
}

export function dateToRiyadhLocal(d: Date): string {
  const shifted = new Date(d.getTime() + 3 * 3_600_000);
  return shifted.toISOString().slice(0, 16);
}
