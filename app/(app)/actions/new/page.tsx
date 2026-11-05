import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireUser, canCreateActions, canSeeConfidential } from "@/lib/auth";
import { lookups } from "@/lib/queries";
import { meetingVisibility } from "@/lib/access";
import { ActionForm, SubmitButton } from "@/components/forms";
import { ActionFields } from "@/components/action-fields";
import { PageHeader } from "@/components/ui";
import { createAction } from "../mutations";

export const metadata = { title: "New action plan" };

export default async function NewActionPage({ searchParams }: { searchParams: Promise<{ meeting?: string; decision?: string }> }) {
  const u = await requireUser();
  if (!canCreateActions(u)) redirect("/actions");
  const sp = await searchParams;
  const lk = await lookups();
  type M = { id: string; title: string; orgs: number[] };
  type D = { id: number; decision: string };
  let meeting: M | null = null;
  let decision: D | null = null;
  if (sp.meeting && /^[0-9a-f-]{36}$/i.test(sp.meeting)) {
    const m = await db.execute(sql`SELECT m.id, m.title, COALESCE((SELECT array_agg(organization_id) FROM meeting_organizations WHERE meeting_id = m.id), '{}') AS orgs
                                   FROM meetings m WHERE m.id = ${sp.meeting} AND ${meetingVisibility(u)}`);
    meeting = (m.rows[0] as unknown as M) ?? null;
    if (meeting && sp.decision && /^\d+$/.test(sp.decision)) {
      const d = await db.execute(sql`SELECT id, decision FROM meeting_decisions WHERE id = ${Number(sp.decision)} AND meeting_id = ${meeting.id} AND action_id IS NULL`);
      decision = (d.rows[0] as unknown as D) ?? null;
    }
  }
  return (
    <>
      <PageHeader title="New action plan" subtitle={meeting ? `From meeting: ${meeting.title}` : "Define the task, accountable owner and timeline."} />
      <div className="card max-w-4xl p-5">
        <ActionForm action={createAction} resetOnSuccess={false}>
          {meeting && <input type="hidden" name="meetingId" value={meeting.id} />}
          {decision && <input type="hidden" name="decisionId" value={decision.id} />}
          <ActionFields lk={lk} withOwner canConfidential={canSeeConfidential(u)} d={{ pointTask: decision?.decision, orgIds: meeting?.orgs, ownerId: u.id }} />
          <div className="mt-6 flex gap-2">
            <SubmitButton pendingText="Creating…">Create action plan</SubmitButton>
          </div>
        </ActionForm>
      </div>
    </>
  );
}
