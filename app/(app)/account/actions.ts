"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { actionUser, revokeAllSessions, createSession } from "@/lib/auth";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/password";
import { audit } from "@/lib/audit";
import { NOTIFICATION_TYPES } from "@/lib/constants";
import { fail, ok, type FormState } from "@/lib/form-state";

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
