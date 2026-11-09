import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { NOTIFICATION_TYPES } from "@/lib/constants";
import { staleAlertDays } from "@/lib/settings";
import { Field } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { PageHeader, Section } from "@/components/ui";
import { saveEmailSettings, saveStaleDays } from "../mutations";

export const metadata = { title: "System Settings" };

export default async function SettingsPage() {
  const me = await requireUser();
  if (me.role !== "system_owner") notFound();
  const [s] = await db.select().from(schema.systemSettings).where(eq(schema.systemSettings.key, "email_notifications"));
  const v = (s?.value ?? {}) as { enabled?: boolean; types?: Record<string, boolean> };
  const staleDays = await staleAlertDays();
  return (
    <>
      <PageHeader title="System Settings" />
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Email notifications (organization-wide)">
          <ActionForm action={saveEmailSettings} resetOnSuccess={false} className="space-y-2">
            <label className="inline-flex items-center gap-2 text-sm font-medium"><input type="checkbox" name="enabled" defaultChecked={v.enabled !== false} className="accent-[#ce102c]" /> Send email notifications</label>
            <div className="grid gap-1 pl-6 sm:grid-cols-2">
              {Object.entries(NOTIFICATION_TYPES).map(([k, label]) => <label key={k} className="inline-flex items-center gap-2 text-sm text-fg-2"><input type="checkbox" name={`type:${k}`} defaultChecked={v.types?.[k] !== false} className="accent-[#ce102c]" />{label}</label>)}
            </div>
            <SubmitButton className="btn btn-secondary btn-sm">Save</SubmitButton>
          </ActionForm>
        </Section>
        <Section title="No-progress alert">
          <ActionForm action={saveStaleDays} resetOnSuccess={false} className="flex flex-wrap items-end gap-3">
            <Field label="Alert the holder's manager after (days without an update)" className="w-80 max-w-full">
              <input className="input" type="number" name="days" min={1} max={60} defaultValue={staleDays} required />
            </Field>
            <SubmitButton className="btn btn-secondary">Save</SubmitButton>
          </ActionForm>
          <p className="mt-2 text-xs text-muted">Checked daily. The alert goes to the holder&apos;s direct manager (or department director, then company manager) once per idle period.</p>
        </Section>
      </div>
    </>
  );
}
