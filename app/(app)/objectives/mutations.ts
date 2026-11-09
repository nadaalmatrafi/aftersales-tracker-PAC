"use server";

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { actionUser, canManageObjectives, isCompanyManager, isExecutive, type CurrentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { objectiveVisibility } from "@/lib/objectives";
import { CATEGORIES, MAX_ATTACHMENT_BYTES } from "@/lib/constants";
import { fail, int, isoDate, ok, str, uuid, type FormState } from "@/lib/form-state";

async function loadItem(u: CurrentUser, itemId: number) {
  const r = await db.execute(sql`SELECT i.*, o.owner_id, o.created_by AS obj_created_by, o.title AS obj_title, o.id AS obj_id
    FROM objective_items i JOIN objectives o ON o.id = i.objective_id WHERE i.id = ${itemId} AND ${objectiveVisibility(u)}`);
  return r.rows[0] as Record<string, unknown> | undefined;
}
/** Management of an objective (no approval step: deliverables are done when completed with evidence). */
const canManageItem = (u: CurrentUser, it: Record<string, unknown>) =>
  isExecutive(u) || isCompanyManager(u) || u.permissions.has("manage_objectives") || it.owner_id === u.id || it.obj_created_by === u.id;

export async function createObjective(_: FormState, fd: FormData): Promise<FormState> {
  const u = await actionUser();
  if (!canManageObjectives(u)) return fail("You are not authorized to create objectives.");
  const title = str(fd, "title", 300);
  const horizon = str(fd, "horizon");
  const category = str(fd, "category");
  if (!title) return fail("Objective title is required.");
  if (!["30", "60", "90"].includes(horizon ?? "")) return fail("Choose the 30, 60 or 90-day horizon.");
  const [o] = await db
    .insert(schema.objectives)
    .values({
      title,
      description: str(fd, "description", 4000),
      horizon: horizon as "30" | "60" | "90",
      category: category && (CATEGORIES as readonly string[]).includes(category) ? (category as (typeof CATEGORIES)[number]) : null,
      organizationId: int(fd, "organizationId"),
      ownerId: uuid(fd, "ownerId") ?? u.id,
      startDate: isoDate(fd, "startDate"),
      dueDate: isoDate(fd, "dueDate"),
      createdBy: u.id,
    })
    .returning({ id: schema.objectives.id });
  await audit(u.id, "objective", o.id, "create", { title, horizon });
  revalidatePath("/overview");
  return ok("Objective created. Add its measurable deliverables below.");
}

export async function addItem(_: FormState, fd: FormData): Promise<FormState> {
  const u = await actionUser();
  if (!canManageObjectives(u)) return fail("Not authorized.");
  const objectiveId = int(fd, "objectiveId");
  const deliverable = str(fd, "deliverable", 1000);
  if (!objectiveId || !deliverable) return fail("Describe the deliverable.");
  const vis = await db.execute(sql`SELECT o.id FROM objectives o WHERE o.id = ${objectiveId} AND ${objectiveVisibility(u)}`);
  if (!vis.rows.length) return fail("Objective not found.");
  const responsibleId = uuid(fd, "responsibleId");
  const [it] = await db
    .insert(schema.objectiveItems)
    .values({ objectiveId, deliverable, responsibleId, deadline: isoDate(fd, "deadline"), actionId: int(fd, "actionId") })
    .returning({ id: schema.objectiveItems.id });
  await audit(u.id, "objective", objectiveId, "item_add", { itemId: it.id, deliverable });
  if (responsibleId)
    await notify({ userIds: [responsibleId], excludeUserId: u.id, type: "assignment", title: "Objective deliverable assigned", body: deliverable, link: "/overview?obj=1", dedupeKey: `objitem:${it.id}:${responsibleId}` });
  revalidatePath("/overview");
  return ok("Deliverable added.");
}

/** Responsible person ticks the deliverable with evidence; it counts as done straight away (no approval step). */
export async function completeItem(_: FormState, fd: FormData): Promise<FormState> {
  const u = await actionUser();
  const itemId = int(fd, "itemId");
  if (!itemId) return fail("Invalid item.");
  const it = await loadItem(u, itemId);
  if (!it) return fail("Item not found.");
  if (!(it.responsible_id === u.id || canManageItem(u, it))) return fail("Only the responsible person or the objective owner can update this deliverable.");
  const undo = fd.get("undo") === "1";
  if (undo) {
    await db.update(schema.objectiveItems).set({ isDone: false, doneAt: null, doneBy: null, approvalStatus: "none", approvedBy: null, approvedAt: null }).where(eq(schema.objectiveItems.id, itemId));
    await audit(u.id, "objective_item", itemId, "reopen");
    revalidatePath("/overview");
    return ok("Deliverable reopened.");
  }
  const evidence = str(fd, "evidenceNote", 2000);
  const file = fd.get("file");
  const hasFile = file instanceof File && file.size > 0;
  if (!evidence && !hasFile) return fail("Provide supporting evidence (note or file).");
  if (hasFile && (file as File).size > MAX_ATTACHMENT_BYTES) return fail(`“${(file as File).name}” is ${((file as File).size / 1048576).toFixed(1)} MB. The limit is 4 MB — compress it or split it.`);
  await db.transaction(async (tx) => {
    if (hasFile) {
      const f = file as File;
      const buf = Buffer.from(await f.arrayBuffer());
      await tx.insert(schema.attachments).values({ objectiveItemId: itemId, filename: f.name.replace(/[^\w.\- ()]/g, "_").slice(0, 150) || "evidence", mimeType: f.type || "application/octet-stream", sizeBytes: buf.length, sha256: crypto.createHash("sha256").update(buf).digest("hex"), data: buf, uploadedBy: u.id });
    }
    await tx.update(schema.objectiveItems).set({ isDone: true, doneAt: new Date(), doneBy: u.id, evidenceNote: evidence, approvalStatus: "none" }).where(eq(schema.objectiveItems.id, itemId));
    await audit(u.id, "objective_item", itemId, "complete", { evidence: !!evidence, file: hasFile }, tx);
  });
  await notify({
    userIds: [it.owner_id as string, it.obj_created_by as string],
    excludeUserId: u.id,
    type: "step_handoff",
    title: `Deliverable completed: ${it.obj_title}`,
    body: `${u.name} completed "${it.deliverable}".${evidence ? `\nEvidence: ${evidence}` : ""}`,
    link: "/overview?obj=1",
    dedupeKey: `objdone:${itemId}:${Date.now()}`,
  });
  revalidatePath("/overview");
  return ok("Deliverable marked as done.");
}

export async function archiveObjective(_: FormState, fd: FormData): Promise<FormState> {
  const u = await actionUser();
  if (!canManageObjectives(u)) return fail("Not authorized.");
  const id = int(fd, "objectiveId");
  if (!id) return fail("Invalid objective.");
  await db.update(schema.objectives).set({ archivedAt: new Date() }).where(eq(schema.objectives.id, id));
  await audit(u.id, "objective", id, "archive");
  revalidatePath("/overview");
  return ok("Objective archived.");
}
