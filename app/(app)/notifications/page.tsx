import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireUser } from "@/lib/auth";
import { fmtDateTime } from "@/lib/dates";
import { NOTIFICATION_TYPES, type NotificationType } from "@/lib/constants";
import { EmptyState, PageHeader, Badge } from "@/components/ui";
import { markAllRead, markRead } from "../actions/mutations";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const u = await requireUser();
  const r = await db.execute(sql`SELECT * FROM notifications WHERE user_id = ${u.id} ORDER BY created_at DESC LIMIT 200`);
  const rows = r.rows as { id: number; type: NotificationType; title: string; body: string | null; link: string | null; read_at: string | null; created_at: string; email_status: string | null }[];
  return (
    <>
      <PageHeader title="Notifications" subtitle="Assignments, hand-offs, update requests, deadlines and escalations." actions={<form action={markAllRead}><button className="btn btn-secondary">Mark all as read</button></form>} />
      {rows.length === 0 ? <EmptyState title="No notifications yet." /> : (
        <ul className="card divide-y divide-line">
          {rows.map((n) => (
            <li key={n.id} className={`flex flex-wrap items-start justify-between gap-3 p-4 ${n.read_at ? "opacity-70" : ""}`}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {!n.read_at && <span className="h-2 w-2 rounded-full bg-accent" aria-label="Unread" />}
                  {n.link ? <Link href={n.link} className="link font-medium">{n.title}</Link> : <span className="font-medium">{n.title}</span>}
                  <Badge>{NOTIFICATION_TYPES[n.type] ?? n.type}</Badge>
                </div>
                {n.body && <p className="mt-1 whitespace-pre-line text-sm text-fg-2">{n.body}</p>}
                <p className="mt-1 text-xs text-muted">{fmtDateTime(n.created_at)}{n.email_status ? ` · email ${n.email_status}` : ""}</p>
              </div>
              {!n.read_at && <form action={markRead}><input type="hidden" name="id" value={n.id} /><button className="btn btn-ghost btn-sm">Mark read</button></form>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
