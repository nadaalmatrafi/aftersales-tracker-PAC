ALTER TYPE "public"."bp_action_status" ADD VALUE IF NOT EXISTS 'waiting' AFTER 'in_progress';--> statement-breakpoint
ALTER TABLE "action_plans" ADD COLUMN IF NOT EXISTS "request_type" text;--> statement-breakpoint
ALTER TABLE "action_plans" ADD COLUMN IF NOT EXISTS "waiting_for" text;--> statement-breakpoint
ALTER TABLE "action_plans" ADD COLUMN IF NOT EXISTS "waiting_since" timestamp with time zone;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "actions_request_type_idx" ON "action_plans" USING btree ("request_type");
