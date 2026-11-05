import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireUser } from "@/lib/auth";
import { lookups } from "@/lib/queries";
import { ROLE_LABEL, type Role } from "@/lib/constants";
import { fmtRelative } from "@/lib/dates";
import { ActionForm, SubmitButton } from "@/components/forms";
import { UserFields } from "@/components/user-fields";
import { Badge, Field, PageHeader, Section } from "@/components/ui";
import { createUser, resetPassword, setUserActive, updateUser } from "../mutations";

export const metadata = { title: "Users & Permissions" };

export default async function UsersAdmin() {
  const me = await requireUser();
  if (me.role !== "system_owner") notFound();
  const [lk, res] = await Promise.all([
    lookups(),
    db.execute(sql`SELECT u.*, d.name AS dept, d.organization_id AS dept_org, m.name AS manager,
                     COALESCE((SELECT array_agg(organization_id) FROM user_organizations WHERE user_id = u.id), '{}') AS org_ids,
                     COALESCE((SELECT array_agg(permission) FROM user_permissions WHERE user_id = u.id), '{}') AS perms,
                     (SELECT count(*)::int FROM action_plans a WHERE a.owner_id = u.id AND a.deleted_at IS NULL AND a.status NOT IN ('completed','cancelled')) AS open_actions
                   FROM users u LEFT JOIN departments d ON d.id = u.department_id LEFT JOIN users m ON m.id = u.manager_id ORDER BY u.is_active DESC, u.name`),
  ]);
  const users = res.rows as Record<string, unknown>[];
  return (
    <>
      <PageHeader title="Users & Permissions" subtitle={`${users.length} accounts · role-based access with per-user grants`} />
      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-3 xl:col-span-2">
          {users.map((x) => (
            <details key={String(x.id)} className="card">
              <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-4 py-3">
                <span>
                  <span className="font-medium">{String(x.name)}</span>
                  <span className="ml-2 text-xs text-muted">{String(x.email)}{x.dept ? ` · ${x.dept}` : ""}</span>
                </span>
                <span className="flex flex-wrap gap-1.5">
                  <Badge tone="info">{ROLE_LABEL[x.role as Role]}</Badge>
                  {(x.perms as string[]).length > 0 && <Badge>{(x.perms as string[]).length} grants</Badge>}
                  {!x.password_hash && <Badge tone="warn">No password</Badge>}
                  {!x.is_active && <Badge tone="danger">Inactive</Badge>}
                  <span className="text-xs text-muted">{x.open_actions as number} open · last sign-in {fmtRelative(x.last_login_at as string)}</span>
                </span>
              </summary>
              <div className="space-y-4 border-t border-line p-4">
                <ActionForm action={updateUser} resetOnSuccess={false}>
                  <input type="hidden" name="userId" value={String(x.id)} />
                  <UserFields lk={lk} selfId={String(x.id)} d={{ name: String(x.name), email: String(x.email), title: x.title as string, role: String(x.role), departmentId: x.department_id as number, managerId: x.manager_id as string, externalId: x.external_id as string, orgIds: x.org_ids as number[], permissions: x.perms as string[] }} />
                  <div className="mt-3"><SubmitButton className="btn btn-secondary">Save user</SubmitButton></div>
                </ActionForm>
                <div className="flex flex-wrap items-end gap-4 border-t border-line pt-4">
                  <ActionForm action={resetPassword} className="flex items-end gap-2">
                    <input type="hidden" name="userId" value={String(x.id)} />
                    <Field label="Set temporary password"><input className="input h-8" type="text" name="password" minLength={10} required autoComplete="off" /></Field>
                    <SubmitButton className="btn btn-secondary btn-sm">Set</SubmitButton>
                  </ActionForm>
                  {x.id !== me.id && (
                    <ActionForm action={setUserActive}>
                      <input type="hidden" name="userId" value={String(x.id)} />
                      <input type="hidden" name="active" value={x.is_active ? "0" : "1"} />
                      <SubmitButton className={x.is_active ? "btn btn-danger btn-sm" : "btn btn-secondary btn-sm"} confirm={x.is_active ? "Deactivate this user? Their history is kept." : undefined}>{x.is_active ? "Deactivate" : "Activate"}</SubmitButton>
                    </ActionForm>
                  )}
                </div>
              </div>
            </details>
          ))}
        </div>
        <Section title="Add user">
          <ActionForm action={createUser}>
            <UserFields lk={lk} />
            <Field label="Temporary password" className="mt-3" hint="The user must change it at first sign-in."><input className="input" name="password" type="text" minLength={10} required autoComplete="off" /></Field>
            <div className="mt-4"><SubmitButton>Create user</SubmitButton></div>
          </ActionForm>
        </Section>
      </div>
    </>
  );
}
