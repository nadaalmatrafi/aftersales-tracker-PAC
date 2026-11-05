export type FormState = { ok: boolean; error?: string; message?: string; at?: number };

export const ok = (message?: string): FormState => ({ ok: true, message, at: Date.now() });
export const fail = (error: string): FormState => ({ ok: false, error, at: Date.now() });

export function str(fd: FormData, k: string, max = 5000): string | null {
  const v = fd.get(k);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}
export function int(fd: FormData, k: string): number | null {
  const v = Number(fd.get(k));
  return Number.isInteger(v) && v > 0 ? v : null;
}
export function isoDate(fd: FormData, k: string): string | null {
  const v = str(fd, k, 10);
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}
export function uuid(fd: FormData, k: string): string | null {
  const v = str(fd, k, 36);
  return v && /^[0-9a-f-]{36}$/i.test(v) ? v : null;
}
export function money(fd: FormData, k: string): string | null {
  const v = str(fd, k, 20);
  if (v == null) return null;
  const n = Number(v.replace(/,/g, ""));
  return Number.isFinite(n) ? n.toFixed(2) : null;
}
export function all(fd: FormData, k: string): string[] {
  return fd.getAll(k).filter((v): v is string => typeof v === "string" && v.length > 0);
}
