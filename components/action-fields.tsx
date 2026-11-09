import type { Lookup } from "@/lib/queries";
import { CATEGORIES, CATEGORY_LABEL, PRIORITIES, PRIORITY_LABEL, REQUEST_TYPES, REQUEST_TYPE_LABEL } from "@/lib/constants";
import { Field } from "./ui";

export type ActionDefaults = {
  status?: string;
  pointTask?: string;
  orgIds?: number[];
  departmentId?: number | null;
  supportDeptIds?: number[];
  contributorIds?: string[];
  ownerId?: string;
  startDate?: string | null;
  targetDate?: string | null;
  priority?: string;
  category?: string | null;
  requestType?: string | null;
  waitingFor?: string | null;
  businessImpact?: string | null;
  timelineNote?: string | null;
  isConfidential?: boolean;
};

export function ActionFields({ lk, d = {}, withOwner, withStatus, canConfidential }: { lk: Lookup; d?: ActionDefaults; withOwner?: boolean; withStatus?: boolean; canConfidential?: boolean }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {withStatus && (
        <Field label="Status" hint="Set by management. No approval step here: Completed closes the action.">
          <select className="input" name="status" defaultValue={d.status === "pending_approval" ? "in_progress" : d.status}>
            <option value="not_started">Not Started</option>
            <option value="in_progress">In Progress</option>
            <option value="waiting">Waiting (on something outside this system)</option>
            <option value="on_hold">On Hold</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </Field>
      )}
      {withStatus && (
        <Field label="Waiting for" hint="Required when the status is Waiting — e.g. “Finance decision”, “Supplier quotation”.">
          <input className="input" name="waitingFor" maxLength={300} defaultValue={d.waitingFor ?? ""} />
        </Field>
      )}
      <Field label="Request type">
        <select className="input" name="requestType" defaultValue={d.requestType ?? ""}>
          <option value="">Not specified</option>
          {REQUEST_TYPES.map((t) => <option key={t} value={t}>{REQUEST_TYPE_LABEL[t]}</option>)}
        </select>
      </Field>
      <Field label="Point / Task" className="md:col-span-2">
        <textarea className="input" name="pointTask" required maxLength={2000} rows={3} defaultValue={d.pointTask} />
      </Field>
      <fieldset className="md:col-span-2">
        <legend className="label">Organizations</legend>
        <div className="flex flex-wrap gap-4">
          {lk.orgs.map((o) => (
            <label key={o.id} className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" name="orgIds" value={o.id} defaultChecked={d.orgIds?.includes(o.id)} className="accent-[#ce102c]" />
              <span><strong className="font-semibold">{o.code}</strong> <span className="text-muted">{o.name}</span></span>
            </label>
          ))}
        </div>
      </fieldset>
      <Field label="Responsible department">
        <select className="input" name="departmentId" defaultValue={d.departmentId ?? ""}>
          <option value="">Not yet assigned</option>
          {lk.departments.map((x) => (
            <option key={x.id} value={x.id}>{x.org_code} · {x.name}</option>
          ))}
        </select>
      </Field>
      {withOwner && (
        <Field label="Responsible person (accountable owner)">
          <select className="input" name="ownerId" defaultValue={d.ownerId ?? ""} required>
            <option value="" disabled>Select…</option>
            {lk.users.map((u) => (
              <option key={u.id} value={u.id}>{u.name}{u.department ? ` · ${u.department}` : ""}</option>
            ))}
          </select>
        </Field>
      )}
      <Field label="Supporting departments" hint="Hold Ctrl / Cmd to select several. Used when the request spans departments.">
        <select className="input h-28" name="supportDeptIds" multiple defaultValue={(d.supportDeptIds ?? []).map(String)}>
          {lk.departments.map((x) => (
            <option key={x.id} value={x.id}>{x.org_code} · {x.name}</option>
          ))}
        </select>
      </Field>
      <Field label="Supporting contributors" hint="Hold Ctrl / Cmd to select several.">
        <select className="input h-28" name="contributorIds" multiple defaultValue={d.contributorIds ?? []}>
          {lk.users.map((u) => (
            <option key={u.id} value={u.id}>{u.name}{u.department ? ` · ${u.department}` : ""}</option>
          ))}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Start date"><input className="input" type="date" name="startDate" defaultValue={d.startDate ?? ""} /></Field>
        <Field label="Target date"><input className="input" type="date" name="targetDate" defaultValue={d.targetDate ?? ""} /></Field>
      </div>
      <Field label="Original timeline (as stated)" hint="Kept as written when no calendar date was given, e.g. “2 Months”.">
        <input className="input" name="timelineNote" maxLength={200} defaultValue={d.timelineNote ?? ""} />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Priority">
          <select className="input" name="priority" defaultValue={d.priority ?? "medium"}>
            {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
          </select>
        </Field>
        <Field label="Objective area">
          <select className="input" name="category" defaultValue={d.category ?? ""}>
            <option value="">—</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Business impact (expected)">
        <textarea className="input" name="businessImpact" rows={2} maxLength={2000} defaultValue={d.businessImpact ?? ""} />
      </Field>
      {canConfidential && (
        <label className="inline-flex items-center gap-2 text-sm md:col-span-2">
          <input type="checkbox" name="isConfidential" defaultChecked={d.isConfidential} className="accent-[#ce102c]" />
          Confidential — visible only to executives and directly involved people
        </label>
      )}
    </div>
  );
}
