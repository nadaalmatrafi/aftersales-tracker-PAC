import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { NOTIFICATION_TYPES, ROLE_LABEL } from "@/lib/constants";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, PageHeader, Section } from "@/components/ui";
import { addLeave, cancelLeave, changePassword, savePreferences } from "./actions";
import { lookups } from "@/lib/queries";
import { fmtDate, todayISO } from "@/lib/dates";

export const metadata = { title: "Account" };

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ first?: string }> }) {
  const u = await requireUser({ allowPasswordChange: true });
  const first = (await searchParams).first === "1" || u.mustChangePassword;
  const prefs = await db.select().from(schema.notificationPreferences).where(eq(schema.notificationPreferences.userId, u.id));
  const pref = (t: string) => prefs.find((p) => p.type === t);
  const [lk, leaves] = await Promise.all([
    lookups(),
    db.execute(sql`SELECT l.id, l.start_date::text AS s, l.end_date::text AS e, l.note, d.name AS delegate FROM leave_periods l JOIN users d ON d.id = l.delegate_id
                   WHERE l.user_id = ${u.id} AND l.cancelled_at IS NULL AND l.end_date >= ${todayISO()}::date ORDER BY l.start_date`),
  ]);
  const lv = leaves.rows as { id: number; s: string; e: string; note: string | null; delegate: string }[];
  return (
    <>
      <PageHeader title="Account" subtitle={`${u.name} · ${u.email} · ${ROLE_LABEL[u.role]}`} />
      {first && <p role="alert" className="card mb-5 border-warn/50 p-4 text-sm text-warn">Set a new personal password before continuing.</p>}
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Change password">
          <ActionForm action={changePassword} className="space-y-3">
            <Field label="Current password"><input className="input" type="password" name="current" autoComplete="current-password" required /></Field>
            <Field label="New password" hint="At least 10 characters with letters and numbers."><input className="input" type="password" name="next" autoComplete="new-password" required minLength={10} /></Field>
            <Field label="Confirm new password"><input className="input" type="password" name="confirm" autoComplete="new-password" required minLength={10} /></Field>
            <SubmitButton>Change password</SubmitButton>
          </ActionForm>
        </Section>
        <Section title="Leave & delegate" className="lg:col-span-2">
          <div id="leave" className="grid gap-5 lg:grid-cols-2">
            <div>
              {lv.length === 0 ? <p className="text-sm text-muted">No upcoming leave.</p> : (
                <ul className="space-y-2">
                  {lv.map((l) => (
                    <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line px-3 py-2 text-sm">
                      <span>{fmtDate(l.s)} – {fmtDate(l.e)} · delegate <strong>{l.delegate}</strong>{l.note ? <span className="text-muted"> · {l.note}</span> : null}</span>
                      <ActionForm action={cancelLeave}><input type="hidden" name="leaveId" value={l.id} /><SubmitButton className="btn btn-ghost btn-sm" confirm="Cancel this leave?">Cancel</SubmitButton></ActionForm>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-3 text-xs text-muted">During your leave your delegate sees and can complete the updates assigned to you and receives a copy of your notifications. “Currently with” shows the delegate, marked as covering for you.</p>
            </div>
            <ActionForm action={addLeave} className="grid gap-3 sm:grid-cols-2">
              <Field label="First day"><input className="input" type="date" name="startDate" required /></Field>
              <Field label="Last day"><input className="input" type="date" name="endDate" required /></Field>
              <Field label="Delegate" className="sm:col-span-2">
                <select className="input" name="delegateId" required defaultValue="">
                  <option value="" disabled>Select…</option>
                  {lk.users.filter((x) => x.id !== u.id).map((x) => <option key={x.id} value={x.id}>{x.name}{x.department ? ` · ${x.department}` : ""}</option>)}
                </select>
              </Field>
              <Field label="Note (optional)" className="sm:col-span-2"><input className="input" name="note" maxLength={300} /></Field>
              <div className="sm:col-span-2"><SubmitButton>Save leave</SubmitButton></div>
            </ActionForm>
          </div>
        </Section>
        <Section title="Notification preferences">
          <ActionForm action={savePreferences} resetOnSuccess={false}>
            <table className="table">
              <thead><tr><th>Event</th><th className="text-center">In-app</th><th className="text-center">Email</th></tr></thead>
              <tbody>
                {Object.entries(NOTIFICATION_TYPES).map(([t, label]) => (
                  <tr key={t}>
                    <td>{label}</td>
                    <td className="text-center"><input type="checkbox" name={`app:${t}`} defaultChecked={pref(t)?.inApp ?? true} aria-label={`${label} in-app`} className="accent-[#ce102c]" /></td>
                    <td className="text-center"><input type="checkbox" name={`email:${t}`} defaultChecked={pref(t)?.email ?? true} aria-label={`${label} email`} className="accent-[#ce102c]" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-3"><SubmitButton className="btn btn-secondary">Save preferences</SubmitButton></div>
          </ActionForm>
        </Section>
      </div>
    </>
  );
}
