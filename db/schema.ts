import {
  pgTable,
  pgEnum,
  serial,
  integer,
  bigserial,
  text,
  boolean,
  timestamp,
  date,
  numeric,
  jsonb,
  uuid,
  primaryKey,
  uniqueIndex,
  index,
  customType,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

export const roleEnum = pgEnum("bp_role", ["system_owner", "ceo", "company_manager", "director", "manager", "employee"]);
export const priorityEnum = pgEnum("bp_priority", ["low", "medium", "high", "critical"]);
// "overdue" is never stored; it is derived from target_date.
export const actionStatusEnum = pgEnum("bp_action_status", [
  "not_started",
  "in_progress",
  "pending_approval",
  "on_hold",
  "completed",
  "cancelled",
]);
export const stepStatusEnum = pgEnum("bp_step_status", ["pending", "in_progress", "blocked", "done", "skipped"]);
export const categoryEnum = pgEnum("bp_category", [
  "revenue_growth",
  "operational_efficiency",
  "financial_performance",
  "customer_development",
  "employee_performance",
]);
export const approvalTypeEnum = pgEnum("bp_approval_type", ["completion", "deadline_extension", "objective_item"]);
export const approvalStatusEnum = pgEnum("bp_approval_status", ["pending", "approved", "rejected", "withdrawn"]);
export const meetingStatusEnum = pgEnum("bp_meeting_status", ["scheduled", "held", "cancelled"]);
export const horizonEnum = pgEnum("bp_horizon", ["30", "60", "90"]);

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const organizations = pgTable("organizations", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const departments = pgTable(
  "departments",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull().references(() => organizations.id),
    name: text("name").notNull(),
    directorId: uuid("director_id"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("departments_org_name_uq").on(t.organizationId, t.name)],
);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    username: text("username"),
    title: text("title"),
    role: roleEnum("role").notNull().default("employee"),
    departmentId: integer("department_id").references(() => departments.id),
    managerId: uuid("manager_id"),
    passwordHash: text("password_hash"),
    externalId: text("external_id"),
    isActive: boolean("is_active").notNull().default(true),
    mustChangePassword: boolean("must_change_password").notNull().default(false),
    failedLogins: integer("failed_logins").notNull().default(0),
    lockedUntil: ts("locked_until"),
    lastLoginAt: ts("last_login_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("users_email_uq").on(sql`lower(${t.email})`),
    uniqueIndex("users_external_id_uq").on(t.externalId),
    uniqueIndex("users_username_uq").on(sql`lower(${t.username})`),
  ],
);

/** Leave periods: while active, the delegate receives the user's steps, approvals and notifications. */
export const leavePeriods = pgTable(
  "leave_periods",
  {
    id: serial("id").primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    delegateId: uuid("delegate_id").notNull().references(() => users.id),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    note: text("note"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: ts("created_at").notNull().defaultNow(),
    cancelledAt: ts("cancelled_at"),
  },
  (t) => [index("leave_user_idx").on(t.userId, t.startDate), check("leave_dates_ck", sql`${t.endDate} >= ${t.startDate}`)],
);

export const userOrganizations = pgTable(
  "user_organizations",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    organizationId: integer("organization_id").notNull().references(() => organizations.id),
  },
  (t) => [primaryKey({ columns: [t.userId, t.organizationId] })],
);

export const userPermissions = pgTable(
  "user_permissions",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    permission: text("permission").notNull(),
    grantedBy: uuid("granted_by"),
    grantedAt: ts("granted_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.permission] })],
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(), // sha256 of the cookie token
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    expiresAt: ts("expires_at").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    ip: text("ip"),
    userAgent: text("user_agent"),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const meetings = pgTable(
  "meetings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    meetingAt: ts("meeting_at").notNull(),
    durationMinutes: integer("duration_minutes").notNull().default(60),
    location: text("location"),
    meetingLink: text("meeting_link"),
    agenda: text("agenda"),
    summary: text("summary"),
    status: meetingStatusEnum("status").notNull().default("scheduled"),
    isConfidential: boolean("is_confidential").notNull().default(false),
    calendarEventId: text("calendar_event_id"),
    calendarSyncedAt: ts("calendar_synced_at"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("meetings_at_idx").on(t.meetingAt)],
);

export const meetingOrganizations = pgTable(
  "meeting_organizations",
  {
    meetingId: uuid("meeting_id").notNull().references(() => meetings.id, { onDelete: "cascade" }),
    organizationId: integer("organization_id").notNull().references(() => organizations.id),
  },
  (t) => [primaryKey({ columns: [t.meetingId, t.organizationId] })],
);

export const meetingAttendees = pgTable(
  "meeting_attendees",
  {
    meetingId: uuid("meeting_id").notNull().references(() => meetings.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id),
    attended: boolean("attended"),
  },
  (t) => [primaryKey({ columns: [t.meetingId, t.userId] })],
);

export const meetingDecisions = pgTable("meeting_decisions", {
  id: serial("id").primaryKey(),
  meetingId: uuid("meeting_id").notNull().references(() => meetings.id, { onDelete: "cascade" }),
  decision: text("decision").notNull(),
  requiresApproval: boolean("requires_approval").notNull().default(false),
  actionId: integer("action_id"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const actionPlans = pgTable(
  "action_plans",
  {
    id: serial("id").primaryKey(),
    code: text("code").notNull().unique(),
    pointTask: text("point_task").notNull(),
    departmentId: integer("department_id").references(() => departments.id),
    ownerId: uuid("owner_id").notNull().references(() => users.id),
    assignedById: uuid("assigned_by_id").references(() => users.id),
    suggestedResponsible: text("suggested_responsible"),
    timelineNote: text("timeline_note"),
    startDate: date("start_date"),
    targetDate: date("target_date"),
    priority: priorityEnum("priority").notNull().default("medium"),
    status: actionStatusEnum("status").notNull().default("not_started"),
    progress: integer("progress").notNull().default(0),
    category: categoryEnum("category"),
    businessImpact: text("business_impact"),
    blocker: text("blocker"),
    isEscalated: boolean("is_escalated").notNull().default(false),
    escalationNote: text("escalation_note"),
    escalatedAt: ts("escalated_at"),
    isConfidential: boolean("is_confidential").notNull().default(false),
    meetingId: uuid("meeting_id").references(() => meetings.id),
    lastUpdateAt: ts("last_update_at"),
    lastUpdateNote: text("last_update_note"),
    completedAt: ts("completed_at"),
    approvedById: uuid("approved_by_id").references(() => users.id),
    cancelledAt: ts("cancelled_at"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    deletedAt: ts("deleted_at"),
    deletedBy: uuid("deleted_by"),
  },
  (t) => [
    index("actions_owner_idx").on(t.ownerId),
    index("actions_dept_idx").on(t.departmentId),
    index("actions_target_idx").on(t.targetDate),
    check("actions_progress_ck", sql`${t.progress} between 0 and 100`),
  ],
);

export const actionOrganizations = pgTable(
  "action_organizations",
  {
    actionId: integer("action_id").notNull().references(() => actionPlans.id, { onDelete: "cascade" }),
    organizationId: integer("organization_id").notNull().references(() => organizations.id),
  },
  (t) => [primaryKey({ columns: [t.actionId, t.organizationId] })],
);

export const actionDepartments = pgTable(
  "action_departments",
  {
    actionId: integer("action_id").notNull().references(() => actionPlans.id, { onDelete: "cascade" }),
    departmentId: integer("department_id").notNull().references(() => departments.id),
  },
  (t) => [primaryKey({ columns: [t.actionId, t.departmentId] })],
);

export const actionContributors = pgTable(
  "action_contributors",
  {
    actionId: integer("action_id").notNull().references(() => actionPlans.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id),
  },
  (t) => [primaryKey({ columns: [t.actionId, t.userId] })],
);

/** Ordered hand-offs across teams/departments — answers "where is it now and with whom". */
export const actionSteps = pgTable(
  "action_steps",
  {
    id: serial("id").primaryKey(),
    actionId: integer("action_id").notNull().references(() => actionPlans.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    title: text("title").notNull(),
    departmentId: integer("department_id").references(() => departments.id),
    assigneeId: uuid("assignee_id").references(() => users.id),
    dueDate: date("due_date"),
    status: stepStatusEnum("status").notNull().default("pending"),
    blockerNote: text("blocker_note"),
    startedAt: ts("started_at"),
    completedAt: ts("completed_at"),
    completedBy: uuid("completed_by").references(() => users.id),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("steps_action_idx").on(t.actionId, t.sequence), index("steps_assignee_idx").on(t.assigneeId)],
);

export const actionAssignments = pgTable("action_assignments", {
  id: serial("id").primaryKey(),
  actionId: integer("action_id").notNull().references(() => actionPlans.id, { onDelete: "cascade" }),
  fromUserId: uuid("from_user_id").references(() => users.id),
  toUserId: uuid("to_user_id").notNull().references(() => users.id),
  assignedById: uuid("assigned_by_id").references(() => users.id),
  note: text("note"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const actionUpdates = pgTable(
  "action_updates",
  {
    id: serial("id").primaryKey(),
    actionId: integer("action_id").notNull().references(() => actionPlans.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id),
    progress: integer("progress"),
    status: actionStatusEnum("status"),
    note: text("note").notNull(),
    isBlocker: boolean("is_blocker").notNull().default(false),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("updates_action_idx").on(t.actionId)],
);

export const actionComments = pgTable("action_comments", {
  id: serial("id").primaryKey(),
  actionId: integer("action_id").notNull().references(() => actionPlans.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id),
  body: text("body").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const attachments = pgTable("attachments", {
  id: uuid("id").primaryKey().defaultRandom(),
  actionId: integer("action_id").references(() => actionPlans.id),
  objectiveItemId: integer("objective_item_id"),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  sha256: text("sha256").notNull(),
  data: bytea("data").notNull(),
  uploadedBy: uuid("uploaded_by").notNull().references(() => users.id),
  createdAt: ts("created_at").notNull().defaultNow(),
  deletedAt: ts("deleted_at"),
});

export const approvalRecords = pgTable(
  "approval_records",
  {
    id: serial("id").primaryKey(),
    type: approvalTypeEnum("type").notNull(),
    actionId: integer("action_id").references(() => actionPlans.id),
    objectiveItemId: integer("objective_item_id"),
    requestedBy: uuid("requested_by").notNull().references(() => users.id),
    requestedAt: ts("requested_at").notNull().defaultNow(),
    requestNote: text("request_note"),
    requestedDate: date("requested_date"),
    status: approvalStatusEnum("status").notNull().default("pending"),
    decidedBy: uuid("decided_by").references(() => users.id),
    decidedAt: ts("decided_at"),
    decisionNote: text("decision_note"),
  },
  (t) => [index("approvals_status_idx").on(t.status)],
);

export const objectives = pgTable("objectives", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  horizon: horizonEnum("horizon").notNull(),
  category: categoryEnum("category"),
  organizationId: integer("organization_id").references(() => organizations.id),
  ownerId: uuid("owner_id").references(() => users.id),
  startDate: date("start_date"),
  dueDate: date("due_date"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: ts("created_at").notNull().defaultNow(),
  archivedAt: ts("archived_at"),
});

export const objectiveItems = pgTable("objective_items", {
  id: serial("id").primaryKey(),
  objectiveId: integer("objective_id").notNull().references(() => objectives.id, { onDelete: "cascade" }),
  deliverable: text("deliverable").notNull(),
  responsibleId: uuid("responsible_id").references(() => users.id),
  deadline: date("deadline"),
  actionId: integer("action_id").references(() => actionPlans.id),
  isDone: boolean("is_done").notNull().default(false),
  doneAt: ts("done_at"),
  doneBy: uuid("done_by").references(() => users.id),
  evidenceNote: text("evidence_note"),
  approvalStatus: text("approval_status").notNull().default("none"), // none | pending | approved | rejected
  approvedBy: uuid("approved_by").references(() => users.id),
  approvedAt: ts("approved_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/** Expected vs confirmed actual business impact per action. */
export const impactRecords = pgTable("impact_records", {
  actionId: integer("action_id").primaryKey().references(() => actionPlans.id, { onDelete: "cascade" }),
  expectedRevenue: numeric("expected_revenue", { precision: 14, scale: 2 }),
  actualRevenue: numeric("actual_revenue", { precision: 14, scale: 2 }),
  expectedSavings: numeric("expected_savings", { precision: 14, scale: 2 }),
  actualSavings: numeric("actual_savings", { precision: 14, scale: 2 }),
  estimatedCost: numeric("estimated_cost", { precision: 14, scale: 2 }),
  actualCost: numeric("actual_cost", { precision: 14, scale: 2 }),
  branchesAffected: integer("branches_affected"),
  employeesAffected: integer("employees_affected"),
  productivityImprovementPct: numeric("productivity_improvement_pct", { precision: 6, scale: 2 }),
  footfallImprovementPct: numeric("footfall_improvement_pct", { precision: 6, scale: 2 }),
  capacityImprovementPct: numeric("capacity_improvement_pct", { precision: 6, scale: 2 }),
  dataSource: text("data_source"),
  actualsConfirmedBy: uuid("actuals_confirmed_by").references(() => users.id),
  actualsConfirmedAt: ts("actuals_confirmed_at"),
  updatedBy: uuid("updated_by").references(() => users.id),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const kpiRecords = pgTable("kpi_records", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  departmentId: integer("department_id").references(() => departments.id),
  metric: text("metric").notNull(),
  periodStart: date("period_start").notNull(),
  value: numeric("value", { precision: 14, scale: 2 }).notNull(),
  target: numeric("target", { precision: 14, scale: 2 }),
  isBaseline: boolean("is_baseline").notNull().default(false),
  source: text("source"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const notifications = pgTable(
  "notifications",
  {
    id: serial("id").primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    link: text("link"),
    dedupeKey: text("dedupe_key").notNull(),
    readAt: ts("read_at"),
    emailStatus: text("email_status"), // sent | skipped | failed | disabled
    emailedAt: ts("emailed_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("notifications_dedupe_uq").on(t.userId, t.dedupeKey), index("notifications_user_idx").on(t.userId)],
);

export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    email: boolean("email").notNull().default(true),
    inApp: boolean("in_app").notNull().default(true),
  },
  (t) => [primaryKey({ columns: [t.userId, t.type] })],
);

export const systemSettings = pgTable("system_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedBy: uuid("updated_by"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    actorId: uuid("actor_id"),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    action: text("action").notNull(),
    changes: jsonb("changes"),
    ip: text("ip"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("audit_entity_idx").on(t.entityType, t.entityId), index("audit_created_idx").on(t.createdAt)],
);
