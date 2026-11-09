import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireUser } from "@/lib/auth";
import { lookups } from "@/lib/queries";
import { ActionForm, SubmitButton } from "@/components/forms";
import { EmptyState, Field, PageHeader, Section } from "@/components/ui";
import { saveDepartment, saveOrganization } from "../mutations";

export const metadata = { title: "Business units" };

export default async function OrgAdmin() {
  const me = await requireUser();
  if (me.role !== "system_owner") notFound();
  const lk = await lookups();
  const cms = (await db.execute(sql`SELECT uo.organization_id, u.name FROM users u JOIN user_organizations uo ON uo.user_id = u.id
                                    WHERE u.role = 'company_manager' AND u.is_active`)).rows as { organization_id: number; name: string }[];
  const directors = lk.users.filter((u) => ["director", "company_manager", "ceo", "system_owner", "manager"].includes(u.role));
  return (
    <>
      <PageHeader title="Business units & departments" />
      <div className="grid gap-5 lg:grid-cols-3">
        {lk.orgs.map((o) => {
          const depts = lk.departments.filter((d) => d.organization_id === o.id);
          return (
            <Section key={o.id} title={`${o.code} · ${depts.length} departments`}>
              <p className="mb-3 text-sm">Company manager: <strong>{cms.find((c) => c.organization_id === o.id)?.name ?? <span className="text-muted">Not assigned</span>}</strong></p>
              <ActionForm action={saveOrganization} resetOnSuccess={false} className="mb-4 flex items-end gap-2">
                <input type="hidden" name="organizationId" value={o.id} />
                <Field label="Organization name" className="flex-1"><input className="input" name="name" defaultValue={o.name} required /></Field>
                <SubmitButton className="btn btn-secondary btn-sm">Save</SubmitButton>
              </ActionForm>
              {depts.length === 0 && <EmptyState title="No departments yet." />}
              <ul className="space-y-3">
                {depts.map((d) => (
                  <li key={d.id}>
                    <ActionForm action={saveDepartment} resetOnSuccess={false} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                      <input type="hidden" name="departmentId" value={d.id} />
                      <input type="hidden" name="organizationId" value={o.id} />
                      <Field label="Department"><input className="input h-8" name="name" defaultValue={d.name} required /></Field>
                      <Field label="Director"><select className="input h-8" name="directorId" defaultValue={d.director_id ?? ""}><option value="">—</option>{directors.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
                      <SubmitButton className="btn btn-ghost btn-sm">Save</SubmitButton>
                    </ActionForm>
                  </li>
                ))}
              </ul>
              <ActionForm action={saveDepartment} className="mt-4 grid grid-cols-[1fr_1fr_auto] items-end gap-2 border-t border-line pt-4">
                <input type="hidden" name="organizationId" value={o.id} />
                <Field label="New department"><input className="input h-8" name="name" required maxLength={120} /></Field>
                <Field label="Director"><select className="input h-8" name="directorId" defaultValue=""><option value="">—</option>{directors.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
                <SubmitButton className="btn btn-secondary btn-sm">Add</SubmitButton>
              </ActionForm>
            </Section>
          );
        })}
      </div>
    </>
  );
}
