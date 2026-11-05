"use server";

import { redirect } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { createSession, clientIp } from "@/lib/auth";
import { verifyPassword } from "@/lib/password";
import { audit } from "@/lib/audit";
import { fail, str, type FormState } from "@/lib/form-state";

const GENERIC = "Invalid email, username or password.";

export async function loginAction(_: FormState, fd: FormData): Promise<FormState> {
  // One field accepts an email address or a username.
  const email = str(fd, "email", 200)?.toLowerCase();
  const password = (fd.get("password") as string) || "";
  if (!email || !password) return fail("Enter your email or username and your password.");

  // Per-IP throttle: at most 20 failed attempts per 15 minutes.
  const ip = await clientIp();
  const recent = await db.execute(sql`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'login_failed' AND ip IS NOT DISTINCT FROM ${ip} AND created_at > now() - interval '15 minutes'`);
  if ((recent.rows[0] as { n: number }).n >= 20) return fail("Too many attempts. Please wait 15 minutes and try again.");

  const [u] = await db
    .select()
    .from(schema.users)
    .where(email.includes("@") ? sql`lower(${schema.users.email}) = ${email}` : sql`lower(${schema.users.username}) = ${email}`)
    .limit(1);
  if (!u || !u.isActive) {
    await audit(null, "auth", email, "login_failed", { reason: "unknown_or_inactive" });
    return fail(GENERIC);
  }
  if (u.lockedUntil && u.lockedUntil > new Date()) return fail("This account is temporarily locked. Try again later or contact the System Owner.");
  if (!verifyPassword(password, u.passwordHash)) {
    const failed = u.failedLogins + 1;
    await db.update(schema.users).set({
      failedLogins: failed,
      lockedUntil: failed >= 5 ? new Date(Date.now() + 15 * 60_000) : null,
    }).where(eq(schema.users.id, u.id));
    await audit(u.id, "auth", u.id, "login_failed", { attempts: failed });
    return fail(GENERIC);
  }
  await db.update(schema.users).set({ failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() }).where(eq(schema.users.id, u.id));
  await createSession(u.id);
  await audit(u.id, "auth", u.id, "login");
  const next = str(fd, "next", 200);
  redirect(next && next.startsWith("/") && !next.startsWith("//") ? next : "/");
}
