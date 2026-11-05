import "server-only";
import crypto from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { and, eq, gt, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Permission, Role } from "./constants";

const COOKIE = "bp_session";
const SESSION_DAYS = 7;

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  title: string | null;
  departmentId: number | null;
  managerId: string | null;
  mustChangePassword: boolean;
  permissions: Set<Permission>;
  orgIds: number[]; // explicit organization scope (executives see all regardless)
  /** Users currently on leave who named this user as their delegate. */
  actingFor: string[];
};

const sha256 = (v: string) => crypto.createHash("sha256").update(v).digest("hex");

export async function clientIp(): Promise<string | null> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
}

export async function createSession(userId: string) {
  const token = crypto.randomBytes(32).toString("base64url");
  const h = await headers();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.insert(schema.sessions).values({
    id: sha256(token),
    userId,
    expiresAt,
    ip: await clientIp(),
    userAgent: h.get("user-agent")?.slice(0, 300) ?? null,
  });
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await db.delete(schema.sessions).where(eq(schema.sessions.id, sha256(token)));
  jar.delete(COOKIE);
}

export async function revokeAllSessions(userId: string) {
  await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
}

export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  const rows = await db
    .select({ u: schema.users })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(and(eq(schema.sessions.id, sha256(token)), gt(schema.sessions.expiresAt, sql`now()`)))
    .limit(1);
  const u = rows[0]?.u;
  if (!u || !u.isActive) return null;
  const [perms, orgs, delegations] = await Promise.all([
    db.select({ p: schema.userPermissions.permission }).from(schema.userPermissions).where(eq(schema.userPermissions.userId, u.id)),
    db
      .select({ o: schema.userOrganizations.organizationId })
      .from(schema.userOrganizations)
      .where(eq(schema.userOrganizations.userId, u.id)),
    db.execute(sql`SELECT user_id FROM leave_periods WHERE delegate_id = ${u.id} AND cancelled_at IS NULL
                   AND (now() AT TIME ZONE 'Asia/Riyadh')::date BETWEEN start_date AND end_date`),
  ]);
  const orgIds = orgs.map((r) => r.o);
  // A user whose department belongs to an organization is always scoped to it.
  if (u.departmentId) {
    const d = await db.select({ o: schema.departments.organizationId }).from(schema.departments).where(eq(schema.departments.id, u.departmentId));
    if (d[0] && !orgIds.includes(d[0].o)) orgIds.push(d[0].o);
  }
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    title: u.title,
    departmentId: u.departmentId,
    managerId: u.managerId,
    mustChangePassword: u.mustChangePassword,
    permissions: new Set(perms.map((p) => p.p as Permission)),
    orgIds,
    actingFor: delegations.rows.map((r) => (r as { user_id: string }).user_id),
  };
});

export async function requireUser(opts: { allowPasswordChange?: boolean } = {}): Promise<CurrentUser> {
  const u = await getCurrentUser();
  if (!u) redirect("/login");
  if (u.mustChangePassword && !opts.allowPasswordChange) redirect("/account?first=1");
  return u;
}

/** For server actions: throws instead of redirecting. */
export async function actionUser(): Promise<CurrentUser> {
  const u = await getCurrentUser();
  if (!u) throw new AuthError("Your session has expired. Please sign in again.");
  return u;
}

export class AuthError extends Error {}

export function isExecutive(u: CurrentUser) {
  return u.role === "system_owner" || u.role === "ceo";
}
export function can(u: CurrentUser, p: Permission) {
  return u.role === "system_owner" || u.permissions.has(p);
}
export function seesAllActions(u: CurrentUser) {
  return isExecutive(u) || u.permissions.has("view_all_actions");
}
export function canSeeConfidential(u: CurrentUser) {
  return isExecutive(u) || u.permissions.has("view_confidential");
}
export function isCompanyManager(u: CurrentUser) {
  return u.role === "company_manager";
}
/** The user plus everyone they are currently covering for. */
export function selfAndDelegators(u: CurrentUser) {
  return [u.id, ...u.actingFor];
}
export function canManageObjectives(u: CurrentUser) {
  return isExecutive(u) || isCompanyManager(u) || u.role === "director" || u.permissions.has("manage_objectives");
}
export function canCreateActions(u: CurrentUser) {
  return isExecutive(u) || isCompanyManager(u) || u.role === "director" || u.permissions.has("assign_any");
}
export function canExport(u: CurrentUser) {
  return isExecutive(u) || isCompanyManager(u) || u.role === "director" || u.permissions.has("export_reports");
}
export function requireRole(u: CurrentUser, roles: Role[]) {
  if (!roles.includes(u.role)) throw new AuthError("You are not authorized to perform this action.");
}
