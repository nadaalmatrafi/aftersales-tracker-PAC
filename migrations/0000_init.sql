CREATE TYPE "public"."bp_action_status" AS ENUM('not_started', 'in_progress', 'pending_approval', 'on_hold', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."bp_approval_status" AS ENUM('pending', 'approved', 'rejected', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."bp_approval_type" AS ENUM('completion', 'deadline_extension', 'objective_item');--> statement-breakpoint
CREATE TYPE "public"."bp_category" AS ENUM('revenue_growth', 'operational_efficiency', 'financial_performance', 'customer_development', 'employee_performance');--> statement-breakpoint
CREATE TYPE "public"."bp_horizon" AS ENUM('30', '60', '90');--> statement-breakpoint
CREATE TYPE "public"."bp_meeting_status" AS ENUM('scheduled', 'held', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."bp_priority" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."bp_role" AS ENUM('system_owner', 'ceo', 'director', 'manager', 'employee');--> statement-breakpoint
CREATE TYPE "public"."bp_step_status" AS ENUM('pending', 'in_progress', 'blocked', 'done', 'skipped');--> statement-breakpoint
CREATE TABLE "action_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"action_id" integer NOT NULL,
	"from_user_id" uuid,
	"to_user_id" uuid NOT NULL,
	"assigned_by_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "action_comments" (
	"id" serial PRIMARY KEY NOT NULL,
	"action_id" integer NOT NULL,
	"user_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "action_contributors" (
	"action_id" integer NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "action_contributors_action_id_user_id_pk" PRIMARY KEY("action_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "action_departments" (
	"action_id" integer NOT NULL,
	"department_id" integer NOT NULL,
	CONSTRAINT "action_departments_action_id_department_id_pk" PRIMARY KEY("action_id","department_id")
);
--> statement-breakpoint
CREATE TABLE "action_organizations" (
	"action_id" integer NOT NULL,
	"organization_id" integer NOT NULL,
	CONSTRAINT "action_organizations_action_id_organization_id_pk" PRIMARY KEY("action_id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "action_plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"point_task" text NOT NULL,
	"department_id" integer,
	"owner_id" uuid NOT NULL,
	"assigned_by_id" uuid,
	"suggested_responsible" text,
	"timeline_note" text,
	"start_date" date,
	"target_date" date,
	"priority" "bp_priority" DEFAULT 'medium' NOT NULL,
	"status" "bp_action_status" DEFAULT 'not_started' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"category" "bp_category",
	"business_impact" text,
	"blocker" text,
	"is_escalated" boolean DEFAULT false NOT NULL,
	"escalation_note" text,
	"escalated_at" timestamp with time zone,
	"is_confidential" boolean DEFAULT false NOT NULL,
	"meeting_id" uuid,
	"last_update_at" timestamp with time zone,
	"last_update_note" text,
	"completed_at" timestamp with time zone,
	"approved_by_id" uuid,
	"cancelled_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	CONSTRAINT "action_plans_code_unique" UNIQUE("code"),
	CONSTRAINT "actions_progress_ck" CHECK ("action_plans"."progress" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "action_steps" (
	"id" serial PRIMARY KEY NOT NULL,
	"action_id" integer NOT NULL,
	"sequence" integer NOT NULL,
	"title" text NOT NULL,
	"department_id" integer,
	"assignee_id" uuid,
	"due_date" date,
	"status" "bp_step_status" DEFAULT 'pending' NOT NULL,
	"blocker_note" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"completed_by" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "action_updates" (
	"id" serial PRIMARY KEY NOT NULL,
	"action_id" integer NOT NULL,
	"user_id" uuid NOT NULL,
	"progress" integer,
	"status" "bp_action_status",
	"note" text NOT NULL,
	"is_blocker" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" "bp_approval_type" NOT NULL,
	"action_id" integer,
	"objective_item_id" integer,
	"requested_by" uuid NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"request_note" text,
	"requested_date" date,
	"status" "bp_approval_status" DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action_id" integer,
	"objective_item_id" integer,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"data" "bytea" NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor_id" uuid,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"action" text NOT NULL,
	"changes" jsonb,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"name" text NOT NULL,
	"director_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "impact_records" (
	"action_id" integer PRIMARY KEY NOT NULL,
	"expected_revenue" numeric(14, 2),
	"actual_revenue" numeric(14, 2),
	"expected_savings" numeric(14, 2),
	"actual_savings" numeric(14, 2),
	"estimated_cost" numeric(14, 2),
	"actual_cost" numeric(14, 2),
	"branches_affected" integer,
	"employees_affected" integer,
	"productivity_improvement_pct" numeric(6, 2),
	"footfall_improvement_pct" numeric(6, 2),
	"capacity_improvement_pct" numeric(6, 2),
	"data_source" text,
	"actuals_confirmed_by" uuid,
	"actuals_confirmed_at" timestamp with time zone,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kpi_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"department_id" integer,
	"metric" text NOT NULL,
	"period_start" date NOT NULL,
	"value" numeric(14, 2) NOT NULL,
	"target" numeric(14, 2),
	"is_baseline" boolean DEFAULT false NOT NULL,
	"source" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meeting_attendees" (
	"meeting_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"attended" boolean,
	CONSTRAINT "meeting_attendees_meeting_id_user_id_pk" PRIMARY KEY("meeting_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "meeting_decisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"meeting_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"requires_approval" boolean DEFAULT false NOT NULL,
	"action_id" integer,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meeting_organizations" (
	"meeting_id" uuid NOT NULL,
	"organization_id" integer NOT NULL,
	CONSTRAINT "meeting_organizations_meeting_id_organization_id_pk" PRIMARY KEY("meeting_id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "meetings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"meeting_at" timestamp with time zone NOT NULL,
	"duration_minutes" integer DEFAULT 60 NOT NULL,
	"location" text,
	"meeting_link" text,
	"agenda" text,
	"summary" text,
	"status" "bp_meeting_status" DEFAULT 'scheduled' NOT NULL,
	"is_confidential" boolean DEFAULT false NOT NULL,
	"calendar_event_id" text,
	"calendar_synced_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"email" boolean DEFAULT true NOT NULL,
	"in_app" boolean DEFAULT true NOT NULL,
	CONSTRAINT "notification_preferences_user_id_type_pk" PRIMARY KEY("user_id","type")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"link" text,
	"dedupe_key" text NOT NULL,
	"read_at" timestamp with time zone,
	"email_status" text,
	"emailed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "objective_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"objective_id" integer NOT NULL,
	"deliverable" text NOT NULL,
	"responsible_id" uuid,
	"deadline" date,
	"action_id" integer,
	"is_done" boolean DEFAULT false NOT NULL,
	"done_at" timestamp with time zone,
	"done_by" uuid,
	"evidence_note" text,
	"approval_status" text DEFAULT 'none' NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "objectives" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"horizon" "bp_horizon" NOT NULL,
	"category" "bp_category",
	"organization_id" integer,
	"owner_id" uuid,
	"start_date" date,
	"due_date" date,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "system_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_organizations" (
	"user_id" uuid NOT NULL,
	"organization_id" integer NOT NULL,
	CONSTRAINT "user_organizations_user_id_organization_id_pk" PRIMARY KEY("user_id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "user_permissions" (
	"user_id" uuid NOT NULL,
	"permission" text NOT NULL,
	"granted_by" uuid,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_permissions_user_id_permission_pk" PRIMARY KEY("user_id","permission")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"title" text,
	"role" "bp_role" DEFAULT 'employee' NOT NULL,
	"department_id" integer,
	"manager_id" uuid,
	"password_hash" text,
	"external_id" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"failed_logins" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "action_assignments" ADD CONSTRAINT "action_assignments_action_id_action_plans_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."action_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_assignments" ADD CONSTRAINT "action_assignments_from_user_id_users_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_assignments" ADD CONSTRAINT "action_assignments_to_user_id_users_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_assignments" ADD CONSTRAINT "action_assignments_assigned_by_id_users_id_fk" FOREIGN KEY ("assigned_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_comments" ADD CONSTRAINT "action_comments_action_id_action_plans_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."action_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_comments" ADD CONSTRAINT "action_comments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_contributors" ADD CONSTRAINT "action_contributors_action_id_action_plans_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."action_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_contributors" ADD CONSTRAINT "action_contributors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_departments" ADD CONSTRAINT "action_departments_action_id_action_plans_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."action_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_departments" ADD CONSTRAINT "action_departments_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_organizations" ADD CONSTRAINT "action_organizations_action_id_action_plans_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."action_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_organizations" ADD CONSTRAINT "action_organizations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_plans" ADD CONSTRAINT "action_plans_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_plans" ADD CONSTRAINT "action_plans_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_plans" ADD CONSTRAINT "action_plans_assigned_by_id_users_id_fk" FOREIGN KEY ("assigned_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_plans" ADD CONSTRAINT "action_plans_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_plans" ADD CONSTRAINT "action_plans_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_plans" ADD CONSTRAINT "action_plans_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_steps" ADD CONSTRAINT "action_steps_action_id_action_plans_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."action_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_steps" ADD CONSTRAINT "action_steps_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_steps" ADD CONSTRAINT "action_steps_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_steps" ADD CONSTRAINT "action_steps_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_steps" ADD CONSTRAINT "action_steps_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_updates" ADD CONSTRAINT "action_updates_action_id_action_plans_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."action_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_updates" ADD CONSTRAINT "action_updates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_records" ADD CONSTRAINT "approval_records_action_id_action_plans_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."action_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_records" ADD CONSTRAINT "approval_records_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_records" ADD CONSTRAINT "approval_records_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_action_id_action_plans_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."action_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "impact_records" ADD CONSTRAINT "impact_records_action_id_action_plans_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."action_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "impact_records" ADD CONSTRAINT "impact_records_actuals_confirmed_by_users_id_fk" FOREIGN KEY ("actuals_confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "impact_records" ADD CONSTRAINT "impact_records_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_records" ADD CONSTRAINT "kpi_records_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_records" ADD CONSTRAINT "kpi_records_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_records" ADD CONSTRAINT "kpi_records_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_attendees" ADD CONSTRAINT "meeting_attendees_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_attendees" ADD CONSTRAINT "meeting_attendees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_decisions" ADD CONSTRAINT "meeting_decisions_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_decisions" ADD CONSTRAINT "meeting_decisions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_organizations" ADD CONSTRAINT "meeting_organizations_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_organizations" ADD CONSTRAINT "meeting_organizations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "objective_items" ADD CONSTRAINT "objective_items_objective_id_objectives_id_fk" FOREIGN KEY ("objective_id") REFERENCES "public"."objectives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "objective_items" ADD CONSTRAINT "objective_items_responsible_id_users_id_fk" FOREIGN KEY ("responsible_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "objective_items" ADD CONSTRAINT "objective_items_action_id_action_plans_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."action_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "objective_items" ADD CONSTRAINT "objective_items_done_by_users_id_fk" FOREIGN KEY ("done_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "objective_items" ADD CONSTRAINT "objective_items_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "objectives" ADD CONSTRAINT "objectives_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "objectives" ADD CONSTRAINT "objectives_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "objectives" ADD CONSTRAINT "objectives_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_organizations" ADD CONSTRAINT "user_organizations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_organizations" ADD CONSTRAINT "user_organizations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "actions_owner_idx" ON "action_plans" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "actions_dept_idx" ON "action_plans" USING btree ("department_id");--> statement-breakpoint
CREATE INDEX "actions_target_idx" ON "action_plans" USING btree ("target_date");--> statement-breakpoint
CREATE INDEX "steps_action_idx" ON "action_steps" USING btree ("action_id","sequence");--> statement-breakpoint
CREATE INDEX "steps_assignee_idx" ON "action_steps" USING btree ("assignee_id");--> statement-breakpoint
CREATE INDEX "updates_action_idx" ON "action_updates" USING btree ("action_id");--> statement-breakpoint
CREATE INDEX "approvals_status_idx" ON "approval_records" USING btree ("status");--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "departments_org_name_uq" ON "departments" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "meetings_at_idx" ON "meetings" USING btree ("meeting_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe_uq" ON "notifications" USING btree ("user_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "users_external_id_uq" ON "users" USING btree ("external_id");