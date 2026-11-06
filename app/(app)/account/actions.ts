"use server";
import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { actionUser, revokeAllSessions, createSession } from "@/lib/auth";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/password";
import { audit } from "@/lib/audit";
import { NOTIFICATION_TYPES } from "@/lib/constants";
import { fail, isoDate, ok, str, uuid, type FormState } from "@/lib/form-state";

export async function changePassword(_: FormState, fd: FormData): Promise<FormState> {
  const u = await actionUser();
  const current = String(fd.get("current") ?? "");
  const next = String(fd.get("next") ?? "");
  if (next !== String(fd.get("confirm") ?? "")) return fail("The new passwords do not match.");
  const problem = passwordProblem(next);
  if (problem) return fail(problem);
  const [row] = await db.select({ h: schema.users.passwordHash }).from(schema.users).where(eq(schema.users.id, u.id));
  if (!verifyPassword(current, row?.h)) return fail("Current password is incorrect.");
  await db.update(schema.users).set({ passwordHash: hashPassword(next), mustChangePassword: false }).where(eq(schema.users.id, u.id));
  await revokeAllSessions(u.id);
  await createSession(u.id);
  await audit(u.id, "user", u.id, "password_change");
  revalidatePath("/", "layout");
  return ok("Password changed. Other sessions were signed out.");
}

export async function savePreferences(_: FormState, fd: FormData): Promise<FormState> {
  const u = await actionUser();
  for (const t of Object.keys(NOTIFICATION_TYPES)) {
    const row = { userId: u.id, type: t, email: fd.get(`email:${t}`) === "on", inApp: fd.get(`app:${t}`) === "on" };
    await db.insert(schema.notificationPreferences).values(row).onConflictDoUpdate({ target: [schema.notificationPreferences.userId, schema.notificationPreferences.type], set: { email: row.email, inApp: row.inApp } });
  }
  await audit(u.id, "user", u.id, "notification_preferences");
  return ok("Preferences saved.");
}

/** Leave & delegate: while the leave is active, updates and notifications go to the delegate as well. */
export async function addLeave(_: FormState, fd: FormData): Promise<FormState> {
  const u = await actionUser();
  const start = isoDate(fd, "startDate");
  const end = isoDate(fd, "endDate");
  const delegate = uuid(fd, "delegateId");
  if (!start || !end) return fail("Choose the first and last day of your leave.");
  if (end < start) return fail("The last day cannot be before the first day.");
  if (!delegate || delegate === u.id) return fail("Choose a delegate other than yourself.");
  const [d] = await db.select({ id: schema.users.id, active: schema.users.isActive }).from(schema.users).where(eq(schema.users.id, delegate));
  if (!d?.active) return fail("The delegate must be an active user.");
  const overlap = await db.execute(sql`SELECT 1 FROM leave_periods WHERE user_id = ${u.id} AND cancelled_at IS NULL AND start_date <= ${end}::date AND end_date >= ${start}::date`);
  if (overlap.rows.length) return fail("You already have leave in this period. Cancel it first.");
  const chain = await db.execute(sql`SELECT 1 FROM leave_periods WHERE user_id = ${delegate} AND cancelled_at IS NULL AND start_date <= ${end}::date AND end_date >= ${start}::date`);
  if (chain.rows.length) return fail("Your delegate is also on leave during these dates. Choose someone else.");
  const [row] = await db.insert(schema.leavePeriods).values({ userId: u.id, delegateId: delegate, startDate: start, endDate: end, note: str(fd, "note", 300), createdBy: u.id }).returning({ id: schema.leavePeriods.id });
  await audit(u.id, "user", u.id, "leave_add", { leaveId: row.id, start, end, delegate });
  revalidatePath("/account");
  revalidatePath("/");
  return ok("Leave saved. Your delegate will receive your updates and notifications during these dates.");
}

export async function cancelLeave(_: FormState, fd: FormData): Promise<FormState> {
  const u = await actionUser();
  const id = Number(fd.get("leaveId"));
  if (!Number.isInteger(id)) return fail("Invalid leave.");
  const res = await db.update(schema.leavePeriods).set({ cancelledAt: new Date() }).where(and(eq(schema.leavePeriods.id, id), eq(schema.leavePeriods.userId, u.id))).returning({ id: schema.leavePeriods.id });
  if (!res.length) return fail("Leave not found.");
  await audit(u.id, "user", u.id, "leave_cancel", { leaveId: id });
  revalidatePath("/account");
  revalidatePath("/");
  return ok("Leave cancelled.");
}
