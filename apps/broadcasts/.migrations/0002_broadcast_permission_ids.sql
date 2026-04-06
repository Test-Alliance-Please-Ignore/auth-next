ALTER TABLE "broadcast_targets" ADD COLUMN "send_permission_id" uuid;--> statement-breakpoint
ALTER TABLE "broadcast_targets" ADD COLUMN "manage_permission_id" uuid;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD COLUMN "permission_id" uuid;--> statement-breakpoint

-- Temporary backfill for existing rows. Admins should reassign targets/broadcasts to real global permission IDs.
UPDATE "broadcast_targets"
SET
	"send_permission_id" = gen_random_uuid(),
	"manage_permission_id" = gen_random_uuid()
WHERE "send_permission_id" IS NULL OR "manage_permission_id" IS NULL;--> statement-breakpoint
UPDATE "broadcasts" SET "permission_id" = gen_random_uuid() WHERE "permission_id" IS NULL;--> statement-breakpoint

ALTER TABLE "broadcast_targets" ALTER COLUMN "send_permission_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "broadcast_targets" ALTER COLUMN "manage_permission_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "broadcasts" ALTER COLUMN "permission_id" SET NOT NULL;--> statement-breakpoint

DROP INDEX IF EXISTS "broadcast_targets_group_id_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "broadcasts_group_id_idx";--> statement-breakpoint
CREATE INDEX "broadcast_targets_send_permission_id_idx" ON "broadcast_targets" USING btree ("send_permission_id");--> statement-breakpoint
CREATE INDEX "broadcast_targets_manage_permission_id_idx" ON "broadcast_targets" USING btree ("manage_permission_id");--> statement-breakpoint
CREATE INDEX "broadcasts_permission_id_idx" ON "broadcasts" USING btree ("permission_id");--> statement-breakpoint

ALTER TABLE "broadcast_targets" DROP COLUMN "group_id";--> statement-breakpoint
ALTER TABLE "broadcasts" DROP COLUMN "group_id";--> statement-breakpoint
