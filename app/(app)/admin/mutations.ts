"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { actionUser, revokeAllSessions, type CurrentUser } from "@/lib/auth";
import { hashPassword, passwordProblem } from "@/lib/password";
import { audit } from "@/lib/audit";
import { PERMISSIONS, ROLES, NOTIFICATION_TYPES, type Permission, type Role } from "@/lib/constants";
import { all, fail, int, ok, str, uuid, type FormState } from "@/lib/form-state";

/** Usernames: letters, digits, dot, dash, underscore. A company manager leads exactly one company, one per company. */
async function validateUser(f: ReturnType<typeof userFields>, userId: string | null): Promise<string | null> {
  if (f.username && !/^[a-z0-9._-]{3,60}$/.test(f.username)) return "Username: 3–60 characters, letters, numbers, dot, dash or underscore.";
  if (f.username) {
    const taken = await db.execute(sql`SELECT 1 FROM users WHERE lower(username) = ${f.username} AND id IS DISTINCT FROM ${userId}::uuid`);
    if (taken.rows.length) return "This username is already used by another account.";
  }
  if (f.role === "company_manager") {
    if (f.orgIds.length !== 1) return "A company manager must have access to exactly one company.";
    const other = await db.execute(sql`SELECT u.name FROM users u JOIN user_organizations uo ON uo.user_id = u.id
      WHERE u.role = 'company_manager' AND u.is_active AND uo.organization_id = ${f.orgIds[0]} AND u.id IS DISTINCT FROM ${userId}::uuid LIMIT 1`);
    if (other.rows.length) return `This company already has a company manager (${(other.rows[0] as { name: string }).name}).`;
  }
  return null;
}

async function owner(): Promise<CurrentUser> {
  const u = await actionUser();
  if (u.role !== "system_owner") throw new Error("forbidden");
  return u;
}
const guard = async <T,>(fn: (u: CurrentUser) => Promise<T>): Promise<T | FormState> => {
  try {
    return await fn(await owner());
  } catch (e) {
    if (e instanceof Error && e.message === "forbidden") return fail("Only the System Owner can perform this action.");
    if (e && typeof e === "object" && "code" in e && (e as { code: string }).code === "23505") return fail("A record with the same unique value already exists (e.g. email).");
    console.error(e);
    return fail("The change could not be saved.");
  }
};

function userFields(fd: FormData) {
  const role = str(fd, "role") as Role | null;
  return {
    name: str(fd, "name", 120),
    email: str(fd, "email", 200)?.toLowerCase() ?? null,
    username: str(fd, "username", 60)?.toLowerCase() ?? null,
    title: str(fd, "title", 120),
    role: role && (ROLES as readonly string[]).includes(role) ? role : null,
    departmentId: int(fd, "departmentId"),
    managerId: uuid(fd, "managerId"),
    externalId: str(fd, "externalId", 120),
    orgIds: all(fd, "orgIds").map(Number).filter((n) => Number.isInteger(n) && n > 0),
    permissions: all(fd, "permissions").filter((p): p is Permission => p in PERMISSIONS),
  };
}

export async function createUser(_: FormState, fd: FormData): Promise<FormState> {
  return guard(async (u) => {
    const f = userFields(fd);
    if (!f.name || !f.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email)) return fail("Name and a valid email are required.");
    if (!f.role) return fail("Choose a role.");
    const invalid = await validateUser(f, null);
    if (invalid) return fail(invalid);
    const pw = String(fd.get("password") ?? "");
    const problem = passwordProblem(pw);
    if (problem) return fail(`Temporary password: ${problem}`);
    const exists = await db.execute(sql`SELECT 1 FROM users WHERE lower(email) = ${f.email} OR (${f.externalId}::text IS NOT NULL AND external_id = ${f.externalId})`);
    if (exists.rows.length) return fail("A user with this email or EPMS ID already exists — edit the existing account instead of creating a duplicate.");
    await db.transaction(async (tx) => {
      const [nu] = await tx
        .insert(schema.users)
        .values({ name: f.name!, email: f.email!, username: f.username, title: f.title, role: f.role!, departmentId: f.departmentId, managerId: f.managerId, externalId: f.externalId, passwordHash: hashPassword(pw), mustChangePassword: true })
        .returning({ id: schema.users.id });
      if (f.orgIds.length) await tx.insert(schema.userOrganizations).values(f.orgIds.map((o) => ({ userId: nu.id, organizationId: o })));
      if (f.permissions.length) await tx.insert(schema.userPermissions).values(f.permissions.map((p) => ({ userId: nu.id, permission: p, grantedBy: u.id })));
      await audit(u.id, "user", nu.id, "create", { ...f }, tx);
    });
    revalidatePath("/admin/users");
    return ok(`User ${f.name} created. They must change the temporary password at first sign-in.`);
  });
}

export async function updateUser(_: FormState, fd: FormData): Promise<FormState> {
  return guard(async (u) => {
    const id = uuid(fd, "userId");
    if (!id) return fail("Invalid user.");
    const f = userFields(fd);
    if (!f.name || !f.email || !f.role) return fail("Name, email and role are required.");
    if (id === u.id && f.role !== "system_owner") return fail("You cannot remove your own System Owner role.");
    if (f.managerId === id) return fail("A user cannot report to themselves.");
    const invalid = await validateUser(f, id);
    if (invalid) return fail(invalid);
    const [before] = await db.select().from(schema.users).where(eq(schema.users.id, id));
    if (!before) return fail("User not found.");
    await db.transaction(async (tx) => {
      await tx.update(schema.users).set({ name: f.name!, email: f.email!, username: f.username, title: f.title, role: f.role!, departmentId: f.departmentId, managerId: f.managerId, externalId: f.externalId }).where(eq(schema.users.id, id));
      await tx.delete(schema.userOrganizations).where(eq(schema.userOrganizations.userId, id));
      if (f.orgIds.length) await tx.insert(schema.userOrganizations).values(f.orgIds.map((o) => ({ userId: id, organizationId: o })));
      await tx.delete(schema.userPermissions).where(eq(schema.userPermissions.userId, id));
      if (f.permissions.length) await tx.insert(schema.userPermissions).values(f.permissions.map((p) => ({ userId: id, permission: p, grantedBy: u.id })));
      await audit(u.id, "user", id, "edit", { before: { role: before.role, departmentId: before.departmentId, email: before.email }, after: f }, tx);
    });
    revalidatePath("/admin/users");
    return ok("User saved.");
  });
}

export async function setUserActive(_: FormState, fd: FormData): Promise<FormState> {
  return guard(async (u) => {
    const id = uuid(fd, "userId");
    const active = fd.get("active") === "1";
    if (!id) return fail("Invalid user.");
    if (id === u.id) return fail("You cannot deactivate your own account.");
    await db.update(schema.users).set({ isActive: active }).where(eq(schema.users.id, id));
    if (!active) await revokeAllSessions(id);
    await audit(u.id, "user", id, active ? "activate" : "deactivate");
    revalidatePath("/admin/users");
    return ok(active ? "User activated." : "User deactivated and signed out. Their records and history are kept.");
  });
}

export async function resetPassword(_: FormState, fd: FormData): Promise<FormState> {
  return guard(async (u) => {
    const id = uuid(fd, "userId");
    const pw = String(fd.get("password") ?? "");
    if (!id) return fail("Invalid user.");
    const problem = passwordProblem(pw);
    if (problem) return fail(problem);
    await db.update(schema.users).set({ passwordHash: hashPassword(pw), mustChangePassword: true, failedLogins: 0, lockedUntil: null }).where(eq(schema.users.id, id));
    await revokeAllSessions(id);
    await audit(u.id, "user", id, "password_reset");
    return ok("Temporary password set. The user must change it at next sign-in.");
  });
}

export async function saveDepartment(_: FormState, fd: FormData): Promise<FormState> {
  return guard(async (u) => {
    const id = int(fd, "departmentId");
    const name = str(fd, "name", 120);
    const organizationId = int(fd, "organizationId");
    const directorId = uuid(fd, "directorId");
    if (!name || !organizationId) return fail("Department name and organization are required.");
    if (id) {
      await db.update(schema.departments).set({ name, organizationId, directorId, isActive: fd.get("isActive") !== "off" }).where(eq(schema.departments.id, id));
      await audit(u.id, "department", id, "edit", { name, organizationId, directorId });
    } else {
      const [d] = await db.insert(schema.departments).values({ name, organizationId, directorId }).returning({ id: schema.departments.id });
      await audit(u.id, "department", d.id, "create", { name, organizationId, directorId });
    }
    revalidatePath("/admin/organizations");
    return ok("Department saved.");
  });
}

export async function saveOrganization(_: FormState, fd: FormData): Promise<FormState> {
  return guard(async (u) => {
    const id = int(fd, "organizationId");
    const name = str(fd, "name", 120);
    if (!id || !name) return fail("Name is required.");
    await db.update(schema.organizations).set({ name }).where(eq(schema.organizations.id, id));
    await audit(u.id, "organization", id, "edit", { name });
    revalidatePath("/admin/organizations");
    return ok("Organization saved.");
  });
}

export async function saveEmailSettings(_: FormState, fd: FormData): Promise<FormState> {
  return guard(async (u) => {
    const value = { enabled: fd.get("enabled") === "on", types: Object.fromEntries(Object.keys(NOTIFICATION_TYPES).map((t) => [t, fd.get(`type:${t}`) === "on"])) };
    await db.insert(schema.systemSettings).values({ key: "email_notifications", value, updatedBy: u.id }).onConflictDoUpdate({ target: schema.systemSettings.key, set: { value, updatedBy: u.id, updatedAt: new Date() } });
    await audit(u.id, "settings", "email_notifications", "edit", value);
    revalidatePath("/admin/settings");
    return ok("Notification settings saved.");
  });
}

export async function restoreAction(_: FormState, fd: FormData): Promise<FormState> {
  return guard(async (u) => {
    const id = int(fd, "actionId");
    if (!id) return fail("Invalid action.");
    await db.update(schema.actionPlans).set({ deletedAt: null, deletedBy: null }).where(and(eq(schema.actionPlans.id, id), sql`deleted_at IS NOT NULL`));
    await audit(u.id, "action", id, "restore");
    revalidatePath("/admin/deleted");
    revalidatePath("/actions");
    return ok("Action plan restored.");
  });
}

export async function saveStaleDays(_: FormState, fd: FormData): Promise<FormState> {
  return guard(async (u) => {
    const days = Number(fd.get("days"));
    if (!Number.isInteger(days) || days < 1 || days > 60) return fail("Enter a number of days between 1 and 60.");
    await db.insert(schema.systemSettings).values({ key: "stale_alert_days", value: days, updatedBy: u.id }).onConflictDoUpdate({ target: schema.systemSettings.key, set: { value: days, updatedBy: u.id, updatedAt: new Date() } });
    await audit(u.id, "settings", "stale_alert_days", "edit", { days });
    revalidatePath("/admin/settings");
    return ok(`Managers are alerted after ${days} day(s) without an update.`);
  });
}
