ALTER TABLE "moon_scans" ADD COLUMN "region_id" text;--> statement-breakpoint
ALTER TABLE "moon_scans" ADD COLUMN "solar_system_id" text;--> statement-breakpoint
CREATE INDEX "moon_scans_region_moon_idx" ON "moon_scans" USING btree ("region_id","moon_id");