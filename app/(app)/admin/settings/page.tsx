import { notFound } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { NOTIFICATION_TYPES } from "@/lib/constants";
import { emailConfigured } from "@/lib/email";
import { staleAlertDays } from "@/lib/settings";
import { Field } from "@/components/ui";
import { fmtDateTime } from "@/lib/dates";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, EmptyState, PageHeader, Section } from "@/components/ui";
import { restoreAction, saveEmailSettings, saveStaleDays } from "../mutations";

export const metadata = { title: "System Settings" };

export default async function SettingsPage() {
  const me = await requireUser();
  if (me.role !== "system_owner") notFound();
  const [s] = await db.select().from(schema.systemSettings).where(eq(schema.systemSettings.key, "email_notifications"));
  const v = (s?.value ?? {}) as { enabled?: boolean; types?: Record<string, boolean> };
  const staleDays = await staleAlertDays();
  const deleted = (await db.execute(sql`SELECT a.id, a.code, a.point_task, a.deleted_at, u.name FROM action_plans a LEFT JOIN users u ON u.id = a.deleted_by WHERE a.deleted_at IS NOT NULL ORDER BY a.deleted_at DESC`)).rows as { id: number; code: string; point_task: string; deleted_at: string; name: string | null }[];
  const status = (okk: boolean, label: string) => <Badge tone={okk ? "ok" : "warn"}>{label}: {okk ? "configured" : "not configured"}</Badge>;
  return (
    <>
      <PageHeader title="System Settings" />
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Integrations">
          <div className="flex flex-wrap gap-2">
            {status(emailConfigured(), "Resend email")}
            {status(!!process.env.EPMS_SSO_SECRET, "EPMS single sign-on")}
            {status(!!process.env.CRON_SECRET, "Reminder schedule")}
          </div>
          <p className="mt-3 text-xs text-muted">Credentials are server-side environment variables and are never shown in the interface.</p>
        </Section>
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
        <Section title="Deleted action plans (retention)" className="lg:col-span-2">
          {deleted.length === 0 ? <EmptyState title="No deleted action plans." /> : (
            <ul className="divide-y divide-line">{deleted.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span><span className="text-xs text-muted">{d.code}</span> {d.point_task}<span className="block text-xs text-muted">Deleted {fmtDateTime(d.deleted_at)} by {d.name ?? "—"}</span></span>
                <ActionForm action={restoreAction}><input type="hidden" name="actionId" value={d.id} /><SubmitButton className="btn btn-secondary btn-sm">Restore</SubmitButton></ActionForm>
              </li>
            ))}</ul>
          )}
        </Section>
      </div>
    </>
  );
}
