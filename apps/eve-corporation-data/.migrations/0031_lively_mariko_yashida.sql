ALTER TABLE "structure_mining_citadel_extractions" ADD COLUMN "last_attempted_sync_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "structure_mining_citadel_extractions" ADD COLUMN "sync_failure_reason" text;--> statement-breakpoint
ALTER TABLE "structure_moon_drills" ADD COLUMN "last_attempted_sync_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "structure_moon_drills" ADD COLUMN "sync_failure_reason" text;--> statement-breakpoint
ALTER TABLE "structure_skyhooks" ADD COLUMN "last_attempted_sync_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "structure_sovereignty_hubs" ADD COLUMN "last_attempted_sync_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "corporation_structures_last_synced_at_idx" ON "corporation_structures" USING btree ("last_synced_at");