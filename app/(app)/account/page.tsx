import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { NOTIFICATION_TYPES, ROLE_LABEL } from "@/lib/constants";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, PageHeader, Section } from "@/components/ui";
import { changePassword, savePreferences } from "./actions";

export const metadata = { title: "Account" };

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ first?: string }> }) {
  const u = await requireUser({ allowPasswordChange: true });
  const first = (await searchParams).first === "1" || u.mustChangePassword;
  const prefs = await db.select().from(schema.notificationPreferences).where(eq(schema.notificationPreferences.userId, u.id));
  const pref = (t: string) => prefs.find((p) => p.type === t);
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
        <Section title="Notification preferences">
          <ActionForm action={savePreferences} resetOnSuccess={false}>
            <table className="table">
              <thead><tr><th>Event</th><th className="text-center">In-app</th><th className="text-center">Email</th></tr></thead>
              <tbody>
                {Object.entries(NOTIFICATION_TYPES).map(([t, label]) => (
                  <tr key={t}>
                    <td>{label}</td>
                    <td className="text-center"><input type="checkbox" name={`app:${t}`} defaultChecked={pref(t)?.inApp ?? true} aria-label={`${label} in-app`} className="accent-[#e2242f]" /></td>
                    <td className="text-center"><input type="checkbox" name={`email:${t}`} defaultChecked={pref(t)?.email ?? true} aria-label={`${label} email`} className="accent-[#e2242f]" /></td>
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
