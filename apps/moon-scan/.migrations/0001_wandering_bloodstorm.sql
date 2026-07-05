CREATE TABLE "moon_verified_moon_summaries" (
	"moon_id" text PRIMARY KEY NOT NULL,
	"source_scan_id" text NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verified_by" text,
	"moon_name" text NOT NULL,
	"solar_system_id" text NOT NULL,
	"solar_system_name" text NOT NULL,
	"region_id" text NOT NULL,
	"region_name" text NOT NULL,
	"constellation_id" text NOT NULL,
	"constellation_name" text NOT NULL,
	"security_status" text,
	"highest_rarity" text
);
--> statement-breakpoint
ALTER TABLE "moon_verified_moon_summaries" ADD CONSTRAINT "moon_verified_moon_summaries_source_scan_id_moon_scans_id_fk" FOREIGN KEY ("source_scan_id") REFERENCES "public"."moon_scans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "moon_verified_moon_summaries_source_scan_id_idx" ON "moon_verified_moon_summaries" USING btree ("source_scan_id");--> statement-breakpoint
CREATE INDEX "moon_verified_moon_summaries_verified_at_idx" ON "moon_verified_moon_summaries" USING btree ("verified_at");--> statement-breakpoint
CREATE INDEX "moon_verified_moon_summaries_region_id_idx" ON "moon_verified_moon_summaries" USING btree ("region_id");--> statement-breakpoint
CREATE INDEX "moon_verified_moon_summaries_constellation_id_idx" ON "moon_verified_moon_summaries" USING btree ("constellation_id");--> statement-breakpoint
CREATE INDEX "moon_verified_moon_summaries_moon_name_idx" ON "moon_verified_moon_summaries" USING btree ("moon_name");--> statement-breakpoint
CREATE INDEX "moon_verified_moon_summaries_solar_system_name_idx" ON "moon_verified_moon_summaries" USING btree ("solar_system_name");--> statement-breakpoint
CREATE INDEX "moon_verified_moon_summaries_highest_rarity_idx" ON "moon_verified_moon_summaries" USING btree ("highest_rarity");--> statement-breakpoint
CREATE INDEX "moon_verified_moon_summaries_security_status_idx" ON "moon_verified_moon_summaries" USING btree ("security_status");