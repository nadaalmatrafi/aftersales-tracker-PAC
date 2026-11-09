import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireUser, selfAndDelegators } from "@/lib/auth";
import { listActions } from "@/lib/queries";
import { objectiveVisibility } from "@/lib/objectives";
import { addDaysISO, fmtDate, fmtDateTime, todayISO } from "@/lib/dates";
import { DEADLINE_SOON_DAYS } from "@/lib/constants";
import { ActionTable } from "@/components/action-table";
import { Badge, EmptyState, KpiCard, PageHeader, Section } from "@/components/ui";

export const metadata = { title: "My Work" };

/** Landing page: what is waiting on me right now. */
export default async function MyWork() {
  const u = await requireUser();
  const mine = selfAndDelegators(u);
  const today = todayISO();
  const soon = addDaysISO(today, DEADLINE_SOON_DAYS);
  const [rows, deliverables, notes, myLeave, covering] = await Promise.all([
    listActions(u, {}),
    db.execute(sql`SELECT i.id, i.deliverable, i.deadline::text AS dl, o.title, o.horizon::text AS horizon
                   FROM objective_items i JOIN objectives o ON o.id = i.objective_id
                   WHERE o.archived_at IS NULL AND i.responsible_id = ${u.id} AND NOT i.is_done AND ${objectiveVisibility(u)}
                   ORDER BY i.deadline NULLS LAST LIMIT 10`),
    db.execute(sql`SELECT id, title, link, created_at, read_at FROM notifications WHERE user_id = ${u.id} ORDER BY created_at DESC LIMIT 6`),
    db.execute(sql`SELECT l.start_date::text AS s, l.end_date::text AS e, d.name FROM leave_periods l JOIN users d ON d.id = l.delegate_id
                   WHERE l.user_id = ${u.id} AND l.cancelled_at IS NULL AND l.end_date >= ${today}::date ORDER BY l.start_date LIMIT 1`),
    db.execute(sql`SELECT u.name, l.end_date::text AS e FROM leave_periods l JOIN users u ON u.id = l.user_id
                   WHERE l.delegate_id = ${u.id} AND l.cancelled_at IS NULL AND ${today}::date BETWEEN l.start_date AND l.end_date`),
  ]);
  const open = rows.filter((a) => a.status !== "completed" && a.status !== "cancelled");
  const withMe = open.filter((a) => a.waiting_on_id === u.id);

  const myActions = open.filter((a) => mine.includes(a.owner_id));
  const withMeIds = new Set(withMe.map((a) => a.id));
  // Your actions that are currently with someone else (so nothing is listed twice).
  const myElsewhere = myActions.filter((a) => !withMeIds.has(a.id));
  const myOverdue = myActions.filter((a) => a.effective_status === "overdue");
  const myDueSoon = myActions.filter((a) => a.target_date && a.target_date >= today && a.target_date <= soon);
  const leave = myLeave.rows[0] as { s: string; e: string; name: string } | undefined;
  const cover = covering.rows as { name: string; e: string }[];
  const dlv = deliverables.rows as { id: number; deliverable: string; dl: string | null; title: string; horizon: string }[];
  const nts = notes.rows as { id: number; title: string; link: string | null; created_at: string; read_at: string | null }[];

  return (
    <>
      <PageHeader title="My Work" actions={<Link href="/overview" className="btn btn-secondary">Overview</Link>} />

      {(leave || cover.length > 0) && (
        <div className="mb-4 grid gap-2">
          {leave && <p className="rounded-md border border-orange/50 bg-orange-soft px-4 py-2 text-sm">Your leave is set from {fmtDate(leave.s)} to {fmtDate(leave.e)}. <strong>{leave.name}</strong> covers your updates. <Link href="/account#leave" className="link font-medium">Change</Link></p>}
          {cover.map((c) => (
            <p key={c.name} className="rounded-md border border-orange/50 bg-orange-soft px-4 py-2 text-sm">You are covering for <strong>{c.name}</strong> until {fmtDate(c.e)}. Their updates appear below.</p>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="With you now" value={withMe.length} tone="info" hint="Updates and actions waiting on you" />
        <KpiCard label="Your open deliverables" value={dlv.length} tone="warn" hint="30 / 60 / 90-day objectives" />
        <KpiCard label="Your overdue actions" value={myOverdue.length} tone="danger" />
        <KpiCard label="Your actions due in 7 days" value={myDueSoon.length} tone="warn" />
      </div>

      <div className="mt-5 grid gap-5">
        <Section title={`Waiting on you (${withMe.length})`}>
          <div className="-m-4"><ActionTable rows={withMe} compact emptyText="Nothing is waiting on you right now." /></div>
        </Section>
        <Section title={`Your action plans currently with others (${myElsewhere.length})`} actions={<Link className="text-xs text-muted hover:text-accent" href="/actions">All action plans →</Link>}>
          <div className="-m-4"><ActionTable rows={myElsewhere} compact emptyText="None of your action plans is waiting on someone else." /></div>
        </Section>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Section title="Your objective deliverables" actions={<Link className="text-xs text-muted hover:text-accent" href="/overview?obj=30#objectives">Open checklist →</Link>}>
          {dlv.length === 0 ? <EmptyState title="No open deliverables assigned to you." /> : (
            <ul className="space-y-2">
              {dlv.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="min-w-0"><span className="text-xs text-muted">{d.horizon}-day · {d.title}</span><br />{d.deliverable}</span>
                  <span className="flex items-center gap-2">
                    {d.dl && d.dl < today ? <Badge tone="danger">Overdue</Badge> : null}
                    <span className="text-xs text-muted">{d.dl ? fmtDate(d.dl) : "No deadline"}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Latest notifications" actions={<Link className="text-xs text-muted hover:text-accent" href="/notifications">All →</Link>}>
          {nts.length === 0 ? <EmptyState title="No notifications yet." /> : (
            <ul className="space-y-2">
              {nts.map((n) => (
                <li key={n.id} className="text-sm">
                  {!n.read_at && <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-accent" aria-label="Unread" />}
                  {n.link ? <Link href={n.link} className="link">{n.title}</Link> : n.title}
                  <span className="block text-xs text-muted">{fmtDateTime(n.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </>
  );
}
