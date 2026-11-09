import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireUser } from "@/lib/auth";
import { emailConfigured } from "@/lib/email";
import { fmtDateTime } from "@/lib/dates";
import { NOTIFICATION_TYPES, type NotificationType } from "@/lib/constants";
import { Badge, EmptyState, PageHeader, Section } from "@/components/ui";

export const metadata = { title: "Integrations" };

const STATUS_TONE = { sent: "ok", failed: "danger", skipped: "neutral", disabled: "neutral" } as const;

export default async function IntegrationsPage() {
  const me = await requireUser();
  if (me.role !== "system_owner") notFound();
  const log = (
    await db.execute(sql`SELECT n.id, n.type, n.title, n.email_status, COALESCE(n.emailed_at, n.created_at) AS at, u.name, u.email
                           FROM notifications n JOIN users u ON u.id = n.user_id
                          WHERE n.email_status IS NOT NULL ORDER BY COALESCE(n.emailed_at, n.created_at) DESC LIMIT 100`)
  ).rows as { id: number; type: string; title: string; email_status: keyof typeof STATUS_TONE; at: string; name: string; email: string }[];
  const counts = (await db.execute(sql`SELECT email_status AS s, count(*)::int AS n FROM notifications WHERE email_status IS NOT NULL AND created_at > now() - interval '30 days' GROUP BY 1`)).rows as { s: string; n: number }[];
  const items = [
    { name: "Resend email", ok: emailConfigured(), detail: emailConfigured() ? `Sending as ${process.env.MAIL_FROM}` : "Set RESEND_API_KEY and MAIL_FROM in the hosting environment, then redeploy." },
    { name: "EPMS link & single sign-on", ok: !!process.env.EPMS_SSO_SECRET, detail: process.env.EPMS_URL ? `EPMS: ${process.env.EPMS_URL}` : "Optional. Set EPMS_URL to show the Open EPMS link and EPMS_SSO_SECRET for sign-in from EPMS." },
    { name: "Daily reminders & no-progress alerts", ok: !!process.env.CRON_SECRET, detail: "Runs once a day (deadline reminders, overdue notices, no-progress alerts to managers)." },
  ];
  return (
    <>
      <PageHeader title="Integrations" />
      <div className="grid gap-3 md:grid-cols-3">
        {items.map((i) => (
          <div key={i.name} className="card card-pad">
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium">{i.name}</p>
              <Badge tone={i.ok ? "ok" : "warn"}>{i.ok ? "Connected" : "Not configured"}</Badge>
            </div>
            <p className="mt-2 text-xs text-muted">{i.detail}</p>
          </div>
        ))}
      </div>
      <Section title="Email delivery log (latest 100)" className="mt-5" actions={<span className="text-xs text-muted">Last 30 days: {counts.length ? counts.map((c) => `${c.n} ${c.s}`).join(" · ") : "none"}</span>}>
        {log.length === 0 ? (
          <EmptyState title="No emails sent yet.">{emailConfigured() ? "Emails appear here as notifications go out." : "Email is not configured, so notifications are in-app only."}</EmptyState>
        ) : (
          <div className="-m-4 overflow-x-auto">
            <table className="table">
              <thead><tr><th>When</th><th>To</th><th>Type</th><th>Subject</th><th>Result</th></tr></thead>
              <tbody>
                {log.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap text-xs">{fmtDateTime(r.at)}</td>
                    <td><div>{r.name}</div><div className="text-xs text-muted">{r.email}</div></td>
                    <td className="text-xs">{NOTIFICATION_TYPES[r.type as NotificationType] ?? r.type}</td>
                    <td className="max-w-md text-sm">{r.title}</td>
                    <td><Badge tone={STATUS_TONE[r.email_status] ?? "neutral"}>{r.email_status}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </>
  );
}
