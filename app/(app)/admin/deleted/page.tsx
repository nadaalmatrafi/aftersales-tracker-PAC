import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireUser } from "@/lib/auth";
import { fmtDateTime } from "@/lib/dates";
import { ActionForm, SubmitButton } from "@/components/forms";
import { EmptyState, PageHeader, Section } from "@/components/ui";
import { restoreAction } from "../mutations";

export const metadata = { title: "Deleted items" };

export default async function DeletedItemsPage() {
  const me = await requireUser();
  if (me.role !== "system_owner") notFound();
  const deleted = (
    await db.execute(sql`SELECT a.id, a.code, a.point_task, a.deleted_at, u.name,
                                (SELECT string_agg(o.code, ', ' ORDER BY o.id) FROM action_organizations ao JOIN organizations o ON o.id = ao.organization_id WHERE ao.action_id = a.id) AS orgs
                           FROM action_plans a LEFT JOIN users u ON u.id = a.deleted_by
                          WHERE a.deleted_at IS NOT NULL ORDER BY a.deleted_at DESC`)
  ).rows as { id: number; code: string; point_task: string; deleted_at: string; name: string | null; orgs: string | null }[];
  return (
    <>
      <PageHeader title="Deleted items" />
      <Section title={`Deleted action plans (${deleted.length})`}>
        {deleted.length === 0 ? (
          <EmptyState title="Nothing has been deleted." />
        ) : (
          <ul className="divide-y divide-line">
            {deleted.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="text-xs text-muted">{d.code}{d.orgs ? ` · ${d.orgs}` : ""}</span> {d.point_task}
                  <span className="block text-xs text-muted">Deleted {fmtDateTime(d.deleted_at)} by {d.name ?? "—"}</span>
                </span>
                <ActionForm action={restoreAction}>
                  <input type="hidden" name="actionId" value={d.id} />
                  <SubmitButton className="btn btn-secondary btn-sm" pendingText="Restoring…">Restore</SubmitButton>
                </ActionForm>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
