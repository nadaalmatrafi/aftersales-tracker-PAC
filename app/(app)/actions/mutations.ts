"use server";

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, sql, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { actionUser, canCreateActions, isExecutive, AuthError, type CurrentUser } from "@/lib/auth";
import {
  canApproveAction,
  canDeleteAction,
  canManageAction,
  canManageSteps,
  canReassignAction,
  canUpdateAction,
  isActionOwner,
  type ActionAccessRow,
} from "@/lib/access";
import { loadActionAccess } from "@/lib/queries";
import { audit, diff } from "@/lib/audit";
import { notify, escalationRecipients } from "@/lib/notify";
import { CATEGORIES, MAX_ATTACHMENT_BYTES, PRIORITIES, STEP_STATUSES, type StepStatus } from "@/lib/constants";
import { all, fail, int, isoDate, money, ok, str, uuid, type FormState } from "@/lib/form-state";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function guard(fd: FormData, check: (u: CurrentUser, a: ActionAccessRow) => boolean, msg = "You are not authorized to change this action.") {
  const u = await actionUser();
  const id = int(fd, "actionId");
  if (!id) throw new AuthError("Missing action.");
  const a = await loadActionAccess(u, id);
  if (!a) throw new AuthError("Action not found or not accessible.");
  if (!check(u, a)) throw new AuthError(msg);
  return { u, a, id };
}

function handle(e: unknown): FormState {
  if (e instanceof AuthError) return fail(e.message);
  if (e && typeof e === "object" && "digest" in e && String((e as { digest: string }).digest).startsWith("NEXT_REDIRECT")) throw e;
  console.error(e);
  return fail("The change could not be saved. Please try again.");
}

const done = (id: number) => {
  revalidatePath(`/actions/${id}`);
  revalidatePath("/actions");
  revalidatePath("/");
};

async function touch(tx: Tx, id: number, note: string | null) {
  await tx
    .update(schema.actionPlans)
    .set({ lastUpdateAt: new Date(), updatedAt: new Date(), ...(note ? { lastUpdateNote: note.slice(0, 500) } : {}) })
    .where(eq(schema.actionPlans.id, id));
}

/** Progress follows the workflow when steps exist. */
async function recalcProgress(tx: Tx, id: number) {
  const r = await tx.execute(sql`SELECT count(*)::int AS total, count(*) FILTER (WHERE status IN ('done','skipped'))::int AS done FROM action_steps WHERE action_id = ${id}`);
  const { total, done: d } = r.rows[0] as { total: number; done: number };
  if (total === 0) return;
  const progress = Math.round((d / total) * 100);
  await tx.execute(sql`UPDATE action_plans SET progress = LEAST(${progress}, CASE WHEN status = 'completed' THEN 100 ELSE 99 END),
                        status = CASE WHEN status = 'not_started' AND ${d} > 0 THEN 'in_progress'::bp_action_status ELSE status END
                       WHERE id = ${id}`);
}

async function actionCode(id: number) {
  const [r] = await db.select({ code: schema.actionPlans.code, task: schema.actionPlans.pointTask }).from(schema.actionPlans).where(eq(schema.actionPlans.id, id));
  return r;
}

async function validUser(id: string | null) {
  if (!id) return null;
  const [r] = await db.select({ id: schema.users.id }).from(schema.users).where(and(eq(schema.users.id, id), eq(schema.users.isActive, true)));
  return r?.id ?? null;
}

function parseCore(fd: FormData) {
  const priority = str(fd, "priority") ?? "medium";
  const category = str(fd, "category");
  const progressRaw = fd.get("progress");
  return {
    pointTask: str(fd, "pointTask", 2000),
    departmentId: int(fd, "departmentId"),
    startDate: isoDate(fd, "startDate"),
    targetDate: isoDate(fd, "targetDate"),
    priority: (PRIORITIES as readonly string[]).includes(priority) ? (priority as (typeof PRIORITIES)[number]) : "medium",
    category: category && (CATEGORIES as readonly string[]).includes(category) ? (category as (typeof CATEGORIES)[number]) : null,
    businessImpact: str(fd, "businessImpact", 2000),
    timelineNote: str(fd, "timelineNote", 200),
    isConfidential: fd.get("isConfidential") === "on",
    orgIds: all(fd, "orgIds").map(Number).filter((n) => Number.isInteger(n) && n > 0),
    supportDeptIds: all(fd, "supportDeptIds").map(Number).filter((n) => Number.isInteger(n) && n > 0),
    contributorIds: all(fd, "contributorIds").filter((v) => /^[0-9a-f-]{36}$/i.test(v)),
    progress: progressRaw === null || progressRaw === "" ? null : Math.max(0, Math.min(100, Math.round(Number(progressRaw)))),
  };
}

export async function createAction(_: FormState, fd: FormData): Promise<FormState> {
  let newId: number;
  try {
    const u = await actionUser();
    if (!canCreateActions(u)) return fail("You are not authorized to create action plans.");
    const c = parseCore(fd);
    if (!c.pointTask) return fail("Point / Task is required.");
    if (!c.orgIds.length) return fail("Select at least one organization.");
    if (c.startDate && c.targetDate && c.targetDate < c.startDate) return fail("Target date cannot be before the start date.");
    const ownerId = (await validUser(uuid(fd, "ownerId"))) ?? u.id;
    const meetingId = uuid(fd, "meetingId");
    const decisionId = int(fd, "decisionId");

    const dup = await db.execute(sql`SELECT code FROM action_plans WHERE deleted_at IS NULL AND lower(trim(point_task)) = lower(trim(${c.pointTask})) LIMIT 1`);
    if (dup.rows.length) return fail(`An action with the same Point / Task already exists (${(dup.rows[0] as { code: string }).code}).`);

    newId = await db.transaction(async (tx) => {
      const id = Number(((await tx.execute(sql`SELECT nextval(pg_get_serial_sequence('action_plans','id')) AS id`)).rows[0] as { id: string }).id);
      const code = `BP-${String(id).padStart(4, "0")}`;
      await tx.insert(schema.actionPlans).values({
        id,
        code,
        pointTask: c.pointTask!,
        departmentId: c.departmentId,
        ownerId,
        assignedById: ownerId === u.id ? null : u.id,
        startDate: c.startDate,
        targetDate: c.targetDate,
        priority: c.priority,
        category: c.category,
        businessImpact: c.businessImpact,
        timelineNote: c.timelineNote,
        isConfidential: c.isConfidential,
        meetingId,
        createdBy: u.id,
      });
      await tx.insert(schema.actionOrganizations).values(c.orgIds.map((o) => ({ actionId: id, organizationId: o })));
      const support = c.supportDeptIds.filter((d) => d !== c.departmentId);
      if (support.length) await tx.insert(schema.actionDepartments).values(support.map((d) => ({ actionId: id, departmentId: d })));
      if (c.contributorIds.length)
        await tx.insert(schema.actionContributors).values([...new Set(c.contributorIds)].map((x) => ({ actionId: id, userId: x }))).onConflictDoNothing();
      await tx.insert(schema.actionAssignments).values({ actionId: id, toUserId: ownerId, assignedById: u.id, note: "Created" });
      if (meetingId && decisionId)
        await tx.update(schema.meetingDecisions).set({ actionId: id }).where(and(eq(schema.meetingDecisions.id, decisionId), eq(schema.meetingDecisions.meetingId, meetingId)));
      await audit(u.id, "action", id, "create", { code, ...c }, tx);
      return id;
    });
    const a = await actionCode(newId);
    await notify({
      userIds: [ownerId, ...c.contributorIds],
      excludeUserId: u.id,
      type: "assignment",
      title: `New action assigned: ${a.code}`,
      body: `${u.name} assigned you an action plan:\n${a.task}`,
      link: `/actions/${newId}`,
      dedupeKey: `assign:${newId}:${ownerId}:0`,
    });
  } catch (e) {
    return handle(e);
  }
  revalidatePath("/actions");
  redirect(`/actions/${newId}`);
}

export async function editAction(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const { u, id } = await guard(fd, canManageAction);
    const c = parseCore(fd);
    if (!c.pointTask) return fail("Point / Task is required.");
    if (!c.orgIds.length) return fail("Select at least one organization.");
    if (c.startDate && c.targetDate && c.targetDate < c.startDate) return fail("Target date cannot be before the start date.");
    const [before] = await db.select().from(schema.actionPlans).where(eq(schema.actionPlans.id, id));
    const patch = {
      pointTask: c.pointTask,
      departmentId: c.departmentId,
      startDate: c.startDate,
      targetDate: c.targetDate,
      priority: c.priority,
      category: c.category,
      businessImpact: c.businessImpact,
      timelineNote: c.timelineNote,
      isConfidential: c.isConfidential,
    };
    const changes = diff(before as unknown as Record<string, unknown>, patch);
    await db.transaction(async (tx) => {
      await tx.update(schema.actionPlans).set({ ...patch, updatedAt: new Date() }).where(eq(schema.actionPlans.id, id));
      await tx.delete(schema.actionOrganizations).where(eq(schema.actionOrganizations.actionId, id));
      await tx.insert(schema.actionOrganizations).values(c.orgIds.map((o) => ({ actionId: id, organizationId: o })));
      await tx.delete(schema.actionDepartments).where(eq(schema.actionDepartments.actionId, id));
      const support = c.supportDeptIds.filter((d) => d !== c.departmentId);
      if (support.length) await tx.insert(schema.actionDepartments).values(support.map((d) => ({ actionId: id, departmentId: d })));
      await tx.delete(schema.actionContributors).where(eq(schema.actionContributors.actionId, id));
      if (c.contributorIds.length)
        await tx.insert(schema.actionContributors).values([...new Set(c.contributorIds)].map((x) => ({ actionId: id, userId: x }))).onConflictDoNothing();
      await audit(u.id, "action", id, "edit", { ...changes, orgIds: c.orgIds, supportDeptIds: c.supportDeptIds, contributorIds: c.contributorIds }, tx);
    });
    if (changes.targetDate && before.targetDate) {
      await notify({
        userIds: [before.ownerId],
        excludeUserId: u.id,
        type: "reassignment",
        title: `Deadline changed: ${before.code}`,
        body: `Target date changed from ${before.targetDate ?? "not set"} to ${c.targetDate ?? "not set"} by ${u.name}.`,
        link: `/actions/${id}`,
        dedupeKey: `deadline:${id}:${c.targetDate}`,
      });
    }
    done(id);
    return ok("Action plan saved.");
  } catch (e) {
    return handle(e);
  }
}

const UPDATE_STATUSES = ["not_started", "in_progress", "on_hold", "cancelled"] as const;

export async function postUpdate(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const { u, a, id } = await guard(fd, canUpdateAction);
    const note = str(fd, "note", 4000);
    if (!note) return fail("Describe the update.");
    if (a.status === "completed" || a.status === "cancelled") return fail("This action is closed. Reopen it before posting progress.");
    const status = str(fd, "status");
    const isBlocker = fd.get("isBlocker") === "on";
    const steps = (await db.execute(sql`SELECT count(*)::int AS n FROM action_steps WHERE action_id = ${id}`)).rows[0] as { n: number };
    const rawProgress = fd.get("progress");
    let progress: number | null = rawProgress === null || rawProgress === "" ? null : Math.max(0, Math.min(99, Math.round(Number(rawProgress))));
    if (steps.n > 0) progress = null; // derived from workflow steps
    let newStatus = status && (UPDATE_STATUSES as readonly string[]).includes(status) ? (status as (typeof UPDATE_STATUSES)[number]) : null;
    if (newStatus === "cancelled" && !canManageAction(u, a)) return fail("Only the assigning manager or an executive can cancel an action.");
    if (newStatus === a.status) newStatus = null;
    await db.transaction(async (tx) => {
      await tx.insert(schema.actionUpdates).values({ actionId: id, userId: u.id, progress, status: newStatus, note, isBlocker });
      await tx
        .update(schema.actionPlans)
        .set({
          ...(progress != null ? { progress } : {}),
          ...(newStatus ? { status: newStatus, cancelledAt: newStatus === "cancelled" ? new Date() : null } : {}),
          ...(isBlocker ? { blocker: note.slice(0, 1000) } : fd.get("clearBlocker") === "on" ? { blocker: null } : {}),
          lastUpdateAt: new Date(),
          lastUpdateNote: note.slice(0, 500),
          updatedAt: new Date(),
        })
        .where(eq(schema.actionPlans.id, id));
      await audit(u.id, "action", id, "progress_update", { progress, status: newStatus, isBlocker }, tx);
    });
    done(id);
    return ok("Update recorded.");
  } catch (e) {
    return handle(e);
  }
}

export async function reassignAction(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const { u, a, id } = await guard(fd, canReassignAction);
    const to = await validUser(uuid(fd, "toUserId"));
    if (!to) return fail("Select the new responsible person.");
    if (to === a.ownerId) return fail("This person is already responsible.");
    const note = str(fd, "note", 1000);
    await db.transaction(async (tx) => {
      await tx.insert(schema.actionAssignments).values({ actionId: id, fromUserId: a.ownerId, toUserId: to, assignedById: u.id, note });
      // The delegating person stays accountable as "Assigned By"; previous owner keeps visibility as a contributor.
      await tx.update(schema.actionPlans).set({ ownerId: to, assignedById: u.id, updatedAt: new Date(), lastUpdateAt: new Date(), lastUpdateNote: `Reassigned${note ? `: ${note}` : ""}`.slice(0, 500) }).where(eq(schema.actionPlans.id, id));
      if (a.ownerId !== u.id) await tx.insert(schema.actionContributors).values({ actionId: id, userId: a.ownerId }).onConflictDoNothing();
      await audit(u.id, "action", id, "reassign", { from: a.ownerId, to, note }, tx);
    });
    const info = await actionCode(id);
    const n = (await db.execute(sql`SELECT count(*)::int AS n FROM action_assignments WHERE action_id = ${id}`)).rows[0] as { n: number };
    await notify({
      userIds: [to],
      excludeUserId: u.id,
      type: "reassignment",
      title: `Action assigned to you: ${info.code}`,
      body: `${u.name} assigned you responsibility for:\n${info.task}${note ? `\n\nNote: ${note}` : ""}`,
      link: `/actions/${id}`,
      dedupeKey: `assign:${id}:${to}:${n.n}`,
    });
    await notify({
      userIds: [a.ownerId],
      excludeUserId: u.id,
      type: "reassignment",
      title: `Action reassigned: ${info.code}`,
      body: `${u.name} reassigned this action to another owner.`,
      link: `/actions/${id}`,
      dedupeKey: `unassign:${id}:${a.ownerId}:${n.n}`,
    });
    done(id);
    return ok("Responsibility transferred. History preserved.");
  } catch (e) {
    return handle(e);
  }
}

/* ---------- Workflow steps (cross-department hand-offs) ---------- */

export async function addStep(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const { u, id, a } = await guard(fd, canManageSteps, "You are not authorized to add workflow steps.");
    if (a.status === "completed" || a.status === "cancelled") return fail("This action is closed.");
    const title = str(fd, "title", 500);
    if (!title) return fail("Describe the step.");
    const assigneeId = await validUser(uuid(fd, "assigneeId"));
    const departmentId = int(fd, "departmentId");
    const dueDate = isoDate(fd, "dueDate");
    let stepId = 0;
    await db.transaction(async (tx) => {
      const seq = ((await tx.execute(sql`SELECT COALESCE(max(sequence),0)+1 AS s FROM action_steps WHERE action_id = ${id}`)).rows[0] as { s: number }).s;
      const [s] = await tx.insert(schema.actionSteps).values({ actionId: id, sequence: seq, title, assigneeId, departmentId, dueDate, createdBy: u.id }).returning({ id: schema.actionSteps.id });
      stepId = s.id;
      if (departmentId) {
        const [p] = await tx.select({ d: schema.actionPlans.departmentId }).from(schema.actionPlans).where(eq(schema.actionPlans.id, id));
        if (p.d !== departmentId) await tx.insert(schema.actionDepartments).values({ actionId: id, departmentId }).onConflictDoNothing();
      }
      await recalcProgress(tx, id);
      await touch(tx, id, `Step added: ${title}`);
      await audit(u.id, "action", id, "step_add", { stepId: s.id, title, assigneeId, departmentId, dueDate }, tx);
    });
    if (assigneeId) {
      const info = await actionCode(id);
      await notify({
        userIds: [assigneeId],
        excludeUserId: u.id,
        type: "assignment",
        title: `Workflow step assigned: ${info.code}`,
        body: `${u.name} assigned you a step: "${title}"\nAction: ${info.task}`,
        link: `/actions/${id}`,
        dedupeKey: `step-assign:${stepId}:${assigneeId}`,
      });
    }
    done(id);
    return ok("Step added.");
  } catch (e) {
    return handle(e);
  }
}

export async function setStepStatus(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const u = await actionUser();
    const stepId = int(fd, "stepId");
    const status = str(fd, "status") as StepStatus | null;
    if (!stepId || !status || !(STEP_STATUSES as readonly string[]).includes(status)) return fail("Invalid step update.");
    const [step] = await db.select().from(schema.actionSteps).where(eq(schema.actionSteps.id, stepId));
    if (!step) return fail("Step not found.");
    const a = await loadActionAccess(u, step.actionId);
    if (!a) return fail("Action not accessible.");
    if (!(canManageSteps(u, a) || step.assigneeId === u.id)) return fail("Only the step assignee or the action owner can update this step.");
    if (status === "skipped" && !canManageSteps(u, a)) return fail("Only the action owner can skip a step.");
    const note = str(fd, "note", 1000);
    if (status === "blocked" && !note) return fail("Describe what is blocking this step.");
    await db.transaction(async (tx) => {
      await tx
        .update(schema.actionSteps)
        .set({
          status,
          blockerNote: status === "blocked" ? note : null,
          startedAt: status === "in_progress" && !step.startedAt ? new Date() : step.startedAt,
          completedAt: status === "done" || status === "skipped" ? new Date() : null,
          completedBy: status === "done" || status === "skipped" ? u.id : null,
        })
        .where(eq(schema.actionSteps.id, stepId));
      await tx.insert(schema.actionUpdates).values({
        actionId: step.actionId,
        userId: u.id,
        note: `Step "${step.title}" → ${status.replace("_", " ")}${note ? `: ${note}` : ""}`,
        isBlocker: status === "blocked",
      });
      if (status === "blocked") await tx.update(schema.actionPlans).set({ blocker: `${step.title}: ${note}`.slice(0, 1000) }).where(eq(schema.actionPlans.id, step.actionId));
      else await tx.execute(sql`UPDATE action_plans SET blocker = NULL WHERE id = ${step.actionId} AND NOT EXISTS (SELECT 1 FROM action_steps WHERE action_id = ${step.actionId} AND status = 'blocked')`);
      await recalcProgress(tx, step.actionId);
      await touch(tx, step.actionId, `Step "${step.title}" ${status.replace("_", " ")}`);
      await audit(u.id, "action_step", stepId, "status", { from: step.status, to: status, note }, tx);
    });
    const info = await actionCode(step.actionId);
    if (status === "done" || status === "skipped") {
      // Hand-off: notify whoever the work now waits on.
      const next = (await db.execute(sql`SELECT id, assignee_id, title FROM action_steps WHERE action_id = ${step.actionId} AND status IN ('pending','in_progress','blocked') ORDER BY sequence LIMIT 1`)).rows[0] as
        | { id: number; assignee_id: string | null; title: string }
        | undefined;
      if (next?.assignee_id)
        await notify({
          userIds: [next.assignee_id],
          excludeUserId: u.id,
          type: "step_handoff",
          title: `Your turn: ${info.code}`,
          body: `"${step.title}" was completed by ${u.name}. The next step is with you: "${next.title}".`,
          link: `/actions/${step.actionId}`,
          dedupeKey: `handoff:${next.id}`,
        });
      else if (!next)
        await notify({
          userIds: [a.ownerId],
          excludeUserId: u.id,
          type: "step_handoff",
          title: `All steps finished: ${info.code}`,
          body: `All workflow steps are complete. Submit the action for completion approval when ready.`,
          link: `/actions/${step.actionId}`,
          dedupeKey: `steps-done:${step.actionId}:${stepId}`,
        });
    } else if (status === "blocked") {
      await notify({
        userIds: [a.ownerId, a.assignedById],
        excludeUserId: u.id,
        type: "escalation",
        title: `Step blocked: ${info.code}`,
        body: `${u.name} reported a blocker on "${step.title}":\n${note}`,
        link: `/actions/${step.actionId}`,
        dedupeKey: `blocked:${stepId}:${Date.now()}`,
      });
    }
    done(step.actionId);
    return ok("Step updated.");
  } catch (e) {
    return handle(e);
  }
}

export async function editStep(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const u = await actionUser();
    const stepId = int(fd, "stepId");
    if (!stepId) return fail("Invalid step.");
    const [step] = await db.select().from(schema.actionSteps).where(eq(schema.actionSteps.id, stepId));
    if (!step) return fail("Step not found.");
    const a = await loadActionAccess(u, step.actionId);
    if (!a || !canManageSteps(u, a)) return fail("You are not authorized to edit this step.");
    const op = str(fd, "op");
    await db.transaction(async (tx) => {
      if (op === "up" || op === "down") {
        const neighbor = (await tx.execute(sql`SELECT id, sequence FROM action_steps WHERE action_id = ${step.actionId} AND sequence ${op === "up" ? sql`<` : sql`>`} ${step.sequence} ORDER BY sequence ${op === "up" ? sql`DESC` : sql`ASC`} LIMIT 1`)).rows[0] as { id: number; sequence: number } | undefined;
        if (neighbor) {
          await tx.update(schema.actionSteps).set({ sequence: -1 }).where(eq(schema.actionSteps.id, step.id));
          await tx.update(schema.actionSteps).set({ sequence: step.sequence }).where(eq(schema.actionSteps.id, neighbor.id));
          await tx.update(schema.actionSteps).set({ sequence: neighbor.sequence }).where(eq(schema.actionSteps.id, step.id));
        }
      } else if (op === "delete") {
        if (step.status === "done") throw new AuthError("Completed steps are kept for history and cannot be removed.");
        await tx.delete(schema.actionSteps).where(eq(schema.actionSteps.id, step.id));
        await recalcProgress(tx, step.actionId);
      } else if (op === "reassign") {
        const to = await validUser(uuid(fd, "assigneeId"));
        await tx.update(schema.actionSteps).set({ assigneeId: to, dueDate: isoDate(fd, "dueDate") ?? step.dueDate }).where(eq(schema.actionSteps.id, step.id));
      }
      await touch(tx, step.actionId, null);
      await audit(u.id, "action_step", step.id, op ?? "edit", { title: step.title, assigneeId: fd.get("assigneeId") ?? undefined }, tx);
    });
    if (op === "reassign") {
      const to = uuid(fd, "assigneeId");
      const info = await actionCode(step.actionId);
      if (to)
        await notify({
          userIds: [to],
          excludeUserId: u.id,
          type: "assignment",
          title: `Workflow step assigned: ${info.code}`,
          body: `${u.name} assigned you the step "${step.title}".`,
          link: `/actions/${step.actionId}`,
          dedupeKey: `step-assign:${step.id}:${to}`,
        });
    }
    done(step.actionId);
    return ok("Workflow updated.");
  } catch (e) {
    return handle(e);
  }
}

/* ---------- Comments & attachments ---------- */

export async function addComment(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const { u, id, a } = await guard(fd, (usr, act) => canUpdateAction(usr, act) || canApproveAction(usr, act), "You cannot comment on this action.");
    const body = str(fd, "body", 4000);
    if (!body) return fail("Write a comment.");
    await db.transaction(async (tx) => {
      const [c] = await tx.insert(schema.actionComments).values({ actionId: id, userId: u.id, body }).returning({ id: schema.actionComments.id });
      await touch(tx, id, null);
      await audit(u.id, "action", id, "comment", { commentId: c.id }, tx);
    });
    void a;
    done(id);
    return ok();
  } catch (e) {
    return handle(e);
  }
}

const ALLOWED_MIME = /^(application\/pdf|image\/(png|jpeg|webp|gif)|text\/(plain|csv)|application\/(vnd\.openxmlformats-officedocument\.[a-z.]+|vnd\.ms-excel|msword|vnd\.ms-powerpoint|zip))$/;

export async function uploadAttachment(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const { u, id } = await guard(fd, canUpdateAction, "You cannot upload files to this action.");
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) return fail("Choose a file to upload.");
    if (file.size > MAX_ATTACHMENT_BYTES) return fail("Files must be 10 MB or smaller.");
    const mime = file.type || "application/octet-stream";
    if (!ALLOWED_MIME.test(mime)) return fail("Unsupported file type. Use PDF, Office documents, images, CSV or text.");
    const buf = Buffer.from(await file.arrayBuffer());
    const name = file.name.replace(/[^\w.\- ()]/g, "_").slice(0, 150) || "attachment";
    await db.transaction(async (tx) => {
      const [att] = await tx
        .insert(schema.attachments)
        .values({ actionId: id, filename: name, mimeType: mime, sizeBytes: buf.length, sha256: crypto.createHash("sha256").update(buf).digest("hex"), data: buf, uploadedBy: u.id })
        .returning({ id: schema.attachments.id });
      await touch(tx, id, `Evidence uploaded: ${name}`);
      await audit(u.id, "action", id, "attachment_upload", { attachmentId: att.id, filename: name, size: buf.length }, tx);
    });
    done(id);
    return ok("File uploaded.");
  } catch (e) {
    return handle(e);
  }
}

export async function removeAttachment(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const { u, id, a } = await guard(fd, canUpdateAction);
    const attId = uuid(fd, "attachmentId");
    if (!attId) return fail("Invalid file.");
    const [att] = await db.select({ by: schema.attachments.uploadedBy, name: schema.attachments.filename }).from(schema.attachments).where(and(eq(schema.attachments.id, attId), eq(schema.attachments.actionId, id)));
    if (!att) return fail("File not found.");
    if (att.by !== u.id && !canManageAction(u, a)) return fail("Only the uploader or the assigning manager can remove this file.");
    await db.update(schema.attachments).set({ deletedAt: new Date() }).where(eq(schema.attachments.id, attId));
    await audit(u.id, "action", id, "attachment_remove", { attachmentId: attId, filename: att.name });
    done(id);
    return ok("File removed.");
  } catch (e) {
    return handle(e);
  }
}

/* ---------- Approvals, extensions, escalation ---------- */

async function approversFor(a: ActionAccessRow): Promise<string[]> {
  const res = await db.execute(sql`SELECT u.id FROM users u JOIN user_permissions p ON p.user_id = u.id WHERE u.is_active AND p.permission = 'approve_completion'`);
  const list = [a.assignedById, a.departmentDirectorId, ...res.rows.map((r) => (r as { id: string }).id)].filter((x): x is string => !!x && x !== a.ownerId);
  if (!list.length) {
    const ceo = await db.execute(sql`SELECT id FROM users WHERE is_active AND role = 'ceo'`);
    list.push(...ceo.rows.map((r) => (r as { id: string }).id));
  }
  return [...new Set(list)];
}

export async function requestCompletion(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const { u, a, id } = await guard(fd, (usr, act) => isActionOwner(usr, act) || canManageAction(usr, act), "Only the responsible person can submit for completion.");
    if (a.status === "completed" || a.status === "cancelled") return fail("This action is already closed.");
    if (a.status === "pending_approval") return fail("A completion request is already pending.");
    const open = (await db.execute(sql`SELECT count(*)::int AS n FROM action_steps WHERE action_id = ${id} AND status NOT IN ('done','skipped')`)).rows[0] as { n: number };
    if (open.n > 0) return fail(`${open.n} workflow step(s) are still open. Complete or skip them first.`);
    const note = str(fd, "note", 2000);
    if (!note) return fail("Summarize what was delivered.");
    let approvalId = 0;
    await db.transaction(async (tx) => {
      const [r] = await tx.insert(schema.approvalRecords).values({ type: "completion", actionId: id, requestedBy: u.id, requestNote: note }).returning({ id: schema.approvalRecords.id });
      approvalId = r.id;
      await tx.update(schema.actionPlans).set({ status: "pending_approval", lastUpdateAt: new Date(), lastUpdateNote: `Submitted for completion: ${note}`.slice(0, 500), updatedAt: new Date() }).where(eq(schema.actionPlans.id, id));
      await tx.insert(schema.actionUpdates).values({ actionId: id, userId: u.id, status: "pending_approval", note: `Submitted for completion review: ${note}` });
      await audit(u.id, "action", id, "completion_request", { approvalId: r.id }, tx);
    });
    const info = await actionCode(id);
    await notify({
      userIds: await approversFor(a),
      excludeUserId: u.id,
      type: "approval_request",
      title: `Completion approval requested: ${info.code}`,
      body: `${u.name} submitted this action for completion review.\n\n${info.task}\n\nSummary: ${note}`,
      link: `/actions/${id}`,
      dedupeKey: `approval:${approvalId}`,
    });
    done(id);
    return ok("Submitted for approval.");
  } catch (e) {
    return handle(e);
  }
}

export async function requestExtension(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const { u, a, id } = await guard(fd, canUpdateAction);
    const date = isoDate(fd, "requestedDate");
    const note = str(fd, "note", 2000);
    if (!date) return fail("Choose the proposed new target date.");
    if (!note) return fail("Explain why the extension is needed.");
    const pending = await db.execute(sql`SELECT 1 FROM approval_records WHERE action_id = ${id} AND type = 'deadline_extension' AND status = 'pending'`);
    if (pending.rows.length) return fail("An extension request is already pending.");
    const [r] = await db.insert(schema.approvalRecords).values({ type: "deadline_extension", actionId: id, requestedBy: u.id, requestNote: note, requestedDate: date }).returning({ id: schema.approvalRecords.id });
    await audit(u.id, "action", id, "extension_request", { approvalId: r.id, requestedDate: date });
    const info = await actionCode(id);
    await notify({
      userIds: await approversFor(a),
      excludeUserId: u.id,
      type: "approval_request",
      title: `Deadline extension requested: ${info.code}`,
      body: `${u.name} requests a new target date of ${date}.\nReason: ${note}`,
      link: `/actions/${id}`,
      dedupeKey: `approval:${r.id}`,
    });
    done(id);
    return ok("Extension request submitted.");
  } catch (e) {
    return handle(e);
  }
}

export async function decideApproval(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const u = await actionUser();
    const approvalId = int(fd, "approvalId");
    const decision = str(fd, "decision");
    const note = str(fd, "note", 2000);
    if (!approvalId || (decision !== "approved" && decision !== "rejected")) return fail("Invalid decision.");
    const [rec] = await db.select().from(schema.approvalRecords).where(eq(schema.approvalRecords.id, approvalId));
    if (!rec || rec.status !== "pending" || !rec.actionId) return fail("This request is no longer pending.");
    const a = await loadActionAccess(u, rec.actionId);
    if (!a || !canApproveAction(u, a, rec.requestedBy)) return fail("You are not authorized to decide this request.");
    if (decision === "rejected" && !note) return fail("Give a reason for the rejection.");
    const id = rec.actionId;
    await db.transaction(async (tx) => {
      const upd = await tx
        .update(schema.approvalRecords)
        .set({ status: decision, decidedBy: u.id, decidedAt: new Date(), decisionNote: note })
        .where(and(eq(schema.approvalRecords.id, approvalId), eq(schema.approvalRecords.status, "pending")))
        .returning({ id: schema.approvalRecords.id });
      if (!upd.length) throw new AuthError("This request was already decided.");
      if (rec.type === "completion") {
        if (decision === "approved") {
          await tx.update(schema.actionPlans).set({ status: "completed", progress: 100, completedAt: new Date(), approvedById: u.id, blocker: null, isEscalated: false, lastUpdateAt: new Date(), lastUpdateNote: `Completion approved by ${u.name}`, updatedAt: new Date() }).where(eq(schema.actionPlans.id, id));
          await tx.insert(schema.actionUpdates).values({ actionId: id, userId: u.id, status: "completed", progress: 100, note: `Completion approved${note ? `: ${note}` : ""}` });
        } else {
          await tx.update(schema.actionPlans).set({ status: "in_progress", lastUpdateAt: new Date(), lastUpdateNote: `Completion rejected: ${note}`.slice(0, 500), updatedAt: new Date() }).where(eq(schema.actionPlans.id, id));
          await tx.insert(schema.actionUpdates).values({ actionId: id, userId: u.id, status: "in_progress", note: `Completion rejected: ${note}` });
        }
      } else if (rec.type === "deadline_extension" && decision === "approved" && rec.requestedDate) {
        const [before] = await tx.select({ t: schema.actionPlans.targetDate }).from(schema.actionPlans).where(eq(schema.actionPlans.id, id));
        await tx.update(schema.actionPlans).set({ targetDate: rec.requestedDate, updatedAt: new Date(), lastUpdateAt: new Date(), lastUpdateNote: `Deadline extended to ${rec.requestedDate}` }).where(eq(schema.actionPlans.id, id));
        await tx.insert(schema.actionUpdates).values({ actionId: id, userId: u.id, note: `Deadline extension approved: ${before.t ?? "not set"} → ${rec.requestedDate}` });
      }
      await audit(u.id, "approval", approvalId, decision, { type: rec.type, actionId: id, note }, tx);
    });
    const info = await actionCode(id);
    await notify({
      userIds: [rec.requestedBy, a.ownerId],
      excludeUserId: u.id,
      type: decision === "rejected" ? "rejection" : "approval_request",
      title: `${rec.type === "completion" ? "Completion" : "Extension"} ${decision}: ${info.code}`,
      body: `${u.name} ${decision} the ${rec.type === "completion" ? "completion request" : "deadline extension"}.${note ? `\n\n${note}` : ""}`,
      link: `/actions/${id}`,
      dedupeKey: `decision:${approvalId}`,
    });
    done(id);
    revalidatePath("/meetings");
    return ok(`Request ${decision}.`);
  } catch (e) {
    return handle(e);
  }
}

export async function escalateAction(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const { u, id } = await guard(fd, canUpdateAction);
    const resolve = fd.get("resolve") === "1";
    const note = str(fd, "note", 2000);
    if (!resolve && !note) return fail("Describe the issue that requires executive attention.");
    if (resolve) {
      const a = await loadActionAccess(u, id);
      if (!a || !(canManageAction(u, a) || isExecutive(u))) return fail("Only management can close an escalation.");
    }
    await db.transaction(async (tx) => {
      await tx.update(schema.actionPlans).set(resolve ? { isEscalated: false, escalationNote: null, escalatedAt: null } : { isEscalated: true, escalationNote: note, escalatedAt: new Date() }).where(eq(schema.actionPlans.id, id));
      await tx.insert(schema.actionUpdates).values({ actionId: id, userId: u.id, note: resolve ? "Escalation resolved" : `Escalated to executive management: ${note}`, isBlocker: !resolve });
      await touch(tx, id, resolve ? "Escalation resolved" : `Escalated: ${note}`);
      await audit(u.id, "action", id, resolve ? "escalation_resolved" : "escalate", { note }, tx);
    });
    if (!resolve) {
      const info = await actionCode(id);
      await notify({
        userIds: await escalationRecipients(),
        excludeUserId: u.id,
        type: "escalation",
        title: `Critical escalation: ${info.code}`,
        body: `${u.name} escalated an issue:\n${note}\n\nAction: ${info.task}`,
        link: `/actions/${id}`,
        dedupeKey: `escalate:${id}:${Date.now()}`,
      });
    }
    done(id);
    return ok(resolve ? "Escalation closed." : "Escalated to executive management.");
  } catch (e) {
    return handle(e);
  }
}

export async function reopenAction(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const { u, id, a } = await guard(fd, canManageAction);
    if (a.status !== "completed" && a.status !== "cancelled") return fail("Action is not closed.");
    const note = str(fd, "note", 1000);
    if (!note) return fail("Give a reason for reopening.");
    await db.transaction(async (tx) => {
      await tx.update(schema.actionPlans).set({ status: "in_progress", completedAt: null, cancelledAt: null, approvedById: null, updatedAt: new Date(), lastUpdateAt: new Date(), lastUpdateNote: `Reopened: ${note}` }).where(eq(schema.actionPlans.id, id));
      await recalcProgress(tx, id);
      await tx.insert(schema.actionUpdates).values({ actionId: id, userId: u.id, status: "in_progress", note: `Reopened: ${note}` });
      await audit(u.id, "action", id, "reopen", { note }, tx);
    });
    done(id);
    return ok("Action reopened.");
  } catch (e) {
    return handle(e);
  }
}

export async function deleteAction(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const { u, id } = await guard(fd, (usr) => canDeleteAction(usr), "Only the CEO or System Owner can delete action plans.");
    const reason = str(fd, "reason", 500);
    if (!reason) return fail("A reason is required for deletion.");
    await db.update(schema.actionPlans).set({ deletedAt: new Date(), deletedBy: u.id }).where(eq(schema.actionPlans.id, id));
    await audit(u.id, "action", id, "delete", { reason, retention: "soft-delete; restorable by System Owner" });
  } catch (e) {
    return handle(e);
  }
  revalidatePath("/actions");
  redirect("/actions?deleted=1");
}

/* ---------- Business impact ---------- */

export async function saveImpact(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const { u, id, a } = await guard(fd, canUpdateAction);
    const numInt = (k: string) => {
      const v = str(fd, k, 12);
      const n = v == null ? null : Number(v);
      return n != null && Number.isInteger(n) && n >= 0 ? n : null;
    };
    const values = {
      expectedRevenue: money(fd, "expectedRevenue"),
      expectedSavings: money(fd, "expectedSavings"),
      estimatedCost: money(fd, "estimatedCost"),
      actualRevenue: money(fd, "actualRevenue"),
      actualSavings: money(fd, "actualSavings"),
      actualCost: money(fd, "actualCost"),
      branchesAffected: numInt("branchesAffected"),
      employeesAffected: numInt("employeesAffected"),
      productivityImprovementPct: money(fd, "productivityImprovementPct"),
      footfallImprovementPct: money(fd, "footfallImprovementPct"),
      capacityImprovementPct: money(fd, "capacityImprovementPct"),
      dataSource: str(fd, "dataSource", 500),
    };
    const hasActuals = values.actualRevenue != null || values.actualSavings != null || values.actualCost != null;
    if (hasActuals && !values.dataSource) return fail("Actual results require a data source (e.g. finance report reference).");
    const confirm = fd.get("confirmActuals") === "on";
    if (confirm && !(canManageAction(u, a) || canApproveAction(u, a))) return fail("Only management can confirm actual results.");
    const [before] = await db.select().from(schema.impactRecords).where(eq(schema.impactRecords.actionId, id));
    const actualsChanged =
      before && (before.actualRevenue !== values.actualRevenue || before.actualSavings !== values.actualSavings || before.actualCost !== values.actualCost);
    const row = {
      ...values,
      updatedBy: u.id,
      updatedAt: new Date(),
      ...(confirm ? { actualsConfirmedBy: u.id, actualsConfirmedAt: new Date() } : actualsChanged ? { actualsConfirmedBy: null, actualsConfirmedAt: null } : {}),
    };
    await db.insert(schema.impactRecords).values({ actionId: id, ...row }).onConflictDoUpdate({ target: schema.impactRecords.actionId, set: row });
    await audit(u.id, "action", id, "impact_update", { ...diff((before ?? {}) as Record<string, unknown>, values), confirmed: confirm });
    done(id);
    return ok(confirm ? "Impact saved and actual results confirmed." : "Impact saved.");
  } catch (e) {
    return handle(e);
  }
}

/** Marks every visible notification as read for the current user. */
export async function markAllRead() {
  const u = await actionUser();
  await db.update(schema.notifications).set({ readAt: new Date() }).where(and(eq(schema.notifications.userId, u.id), sql`read_at IS NULL`));
  revalidatePath("/notifications");
}

export async function markRead(fd: FormData) {
  const u = await actionUser();
  const ids = all(fd, "id").map(Number).filter(Number.isInteger);
  if (ids.length) await db.update(schema.notifications).set({ readAt: new Date() }).where(and(eq(schema.notifications.userId, u.id), inArray(schema.notifications.id, ids)));
  revalidatePath("/notifications");
}
