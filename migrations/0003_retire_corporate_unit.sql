-- "Corporate / Shared Services" is replaced by the "All" choice (every company). Hide the unit when nothing uses it.
UPDATE "organizations" SET "is_active" = false
 WHERE "code" = 'CORP'
   AND NOT EXISTS (SELECT 1 FROM "action_organizations" ao WHERE ao."organization_id" = "organizations"."id")
   AND NOT EXISTS (SELECT 1 FROM "user_organizations" uo WHERE uo."organization_id" = "organizations"."id");
