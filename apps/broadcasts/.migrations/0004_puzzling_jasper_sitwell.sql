ALTER TABLE "broadcast_templates" RENAME COLUMN "group_id" TO "target_id";--> statement-breakpoint
DROP INDEX "broadcast_templates_group_id_idx";--> statement-breakpoint
ALTER TABLE "broadcast_templates" ADD CONSTRAINT "broadcast_templates_target_id_broadcast_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."broadcast_targets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "broadcast_templates_target_id_idx" ON "broadcast_templates" USING btree ("target_id");