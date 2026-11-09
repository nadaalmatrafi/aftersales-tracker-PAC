import { redirect } from "next/navigation";
import { requireUser, canCreateActions, canSeeConfidential, isCompanyManager } from "@/lib/auth";
import { lookups } from "@/lib/queries";
import { ActionForm, SubmitButton } from "@/components/forms";
import { ActionFields } from "@/components/action-fields";
import { PageHeader } from "@/components/ui";
import { createAction } from "../mutations";

export const metadata = { title: "New action plan" };

export default async function NewActionPage() {
  const u = await requireUser();
  if (!canCreateActions(u)) redirect("/actions");
  const lk = await lookups();
  // A company manager creates actions for their own company by default.
  const defaultOrgs = isCompanyManager(u) ? u.orgIds : [];
  return (
    <>
      <PageHeader title="New action plan" />
      <div className="card max-w-4xl p-5">
        <ActionForm action={createAction} resetOnSuccess={false}>
          <ActionFields lk={lk} withOwner canConfidential={canSeeConfidential(u)} d={{ orgIds: defaultOrgs, ownerId: u.id }} />
          <div className="mt-6 flex gap-2">
            <SubmitButton pendingText="Creating…">Create action plan</SubmitButton>
          </div>
        </ActionForm>
      </div>
    </>
  );
}
