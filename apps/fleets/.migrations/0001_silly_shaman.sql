ALTER TABLE "fleet_state_cache" ADD COLUMN "not_found" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "fleet_state_cache" ADD COLUMN "not_found_at" timestamp;--> statement-breakpoint
CREATE INDEX "fleet_state_cache_not_found_idx" ON "fleet_state_cache" USING btree ("not_found");