import type { Lookup } from "@/lib/queries";
import { PERMISSIONS, ROLES, ROLE_LABEL } from "@/lib/constants";
import { Field } from "./ui";

export type UserDefaults = { name?: string; email?: string; title?: string | null; role?: string; departmentId?: number | null; managerId?: string | null; externalId?: string | null; orgIds?: number[]; permissions?: string[] };

export function UserFields({ lk, d = {}, selfId }: { lk: Lookup; d?: UserDefaults; selfId?: string }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Full name"><input className="input" name="name" required maxLength={120} defaultValue={d.name} /></Field>
      <Field label="Work email"><input className="input" type="email" name="email" required maxLength={200} defaultValue={d.email} /></Field>
      <Field label="Job title"><input className="input" name="title" maxLength={120} defaultValue={d.title ?? ""} /></Field>
      <Field label="Role">
        <select className="input" name="role" defaultValue={d.role ?? "employee"}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
      </Field>
      <Field label="Department">
        <select className="input" name="departmentId" defaultValue={d.departmentId ?? ""}><option value="">—</option>{lk.departments.map((x) => <option key={x.id} value={x.id}>{x.org_code} · {x.name}</option>)}</select>
      </Field>
      <Field label="Reports to">
        <select className="input" name="managerId" defaultValue={d.managerId ?? ""}><option value="">—</option>{lk.users.filter((x) => x.id !== selfId).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
      </Field>
      <Field label="EPMS employee ID" hint="Links EPMS single sign-on to this account."><input className="input" name="externalId" maxLength={120} defaultValue={d.externalId ?? ""} /></Field>
      <fieldset>
        <legend className="label">Organization access</legend>
        <div className="flex flex-wrap gap-3">{lk.orgs.map((o) => <label key={o.id} className="inline-flex items-center gap-1.5 text-sm"><input type="checkbox" name="orgIds" value={o.id} defaultChecked={d.orgIds?.includes(o.id)} className="accent-[#e2242f]" />{o.code}</label>)}</div>
      </fieldset>
      <fieldset className="sm:col-span-2">
        <legend className="label">Additional permissions</legend>
        <div className="grid gap-1 sm:grid-cols-2">
          {Object.entries(PERMISSIONS).map(([k, v]) => <label key={k} className="inline-flex items-center gap-2 text-sm text-fg-2"><input type="checkbox" name="permissions" value={k} defaultChecked={d.permissions?.includes(k)} className="accent-[#e2242f]" />{v}</label>)}
        </div>
      </fieldset>
    </div>
  );
}
