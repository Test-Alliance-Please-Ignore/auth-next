CREATE TYPE "public"."moon_scan_source" AS ENUM('user', 'system');--> statement-breakpoint
CREATE TYPE "public"."moon_scan_status" AS ENUM('pending', 'verified', 'rejected');--> statement-breakpoint
CREATE TABLE "moon_character_name_cache" (
	"character_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"cached_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "moon_extraction_settings" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"default_reprocessing_yield" text DEFAULT '0.80' NOT NULL,
	"default_cycle_days" integer DEFAULT 30 NOT NULL,
	"fuel_block_price_override" text,
	"magmatic_gas_price_override" text,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "moon_scan_ores" (
	"id" text PRIMARY KEY NOT NULL,
	"scan_id" text NOT NULL,
	"ore_type_id" text NOT NULL,
	"quantity" text NOT NULL,
	CONSTRAINT "moon_scan_ores_unique" UNIQUE("scan_id","ore_type_id")
);
--> statement-breakpoint
CREATE TABLE "moon_scans" (
	"id" text PRIMARY KEY NOT NULL,
	"moon_id" text NOT NULL,
	"submitted_by" text,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "moon_scan_status" DEFAULT 'pending' NOT NULL,
	"source" "moon_scan_source" DEFAULT 'user' NOT NULL,
	"verified_by" text,
	"verified_at" timestamp with time zone,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "moon_structure_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"base_volume_per_hr" text NOT NULL,
	"rig_bonus" text NOT NULL,
	"fuel_per_hr" text NOT NULL,
	"magmatic_gas_per_hr" text,
	"min_cycle_days" integer,
	"max_cycle_days" integer,
	"is_passive" boolean DEFAULT false NOT NULL,
	"lowsec_modifier" text DEFAULT '0.5' NOT NULL,
	"nullsec_modifier" text DEFAULT '1.0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "moon_verified_compositions" (
	"moon_id" text PRIMARY KEY NOT NULL,
	"source_scan_id" text NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verified_by" text
);
--> statement-breakpoint
ALTER TABLE "moon_scan_ores" ADD CONSTRAINT "moon_scan_ores_scan_id_moon_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."moon_scans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moon_verified_compositions" ADD CONSTRAINT "moon_verified_compositions_source_scan_id_moon_scans_id_fk" FOREIGN KEY ("source_scan_id") REFERENCES "public"."moon_scans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "moon_scan_ores_scan_id_idx" ON "moon_scan_ores" USING btree ("scan_id");--> statement-breakpoint
CREATE INDEX "moon_scans_moon_id_idx" ON "moon_scans" USING btree ("moon_id");--> statement-breakpoint
CREATE INDEX "moon_scans_submitted_by_idx" ON "moon_scans" USING btree ("submitted_by");--> statement-breakpoint
CREATE INDEX "moon_scans_status_idx" ON "moon_scans" USING btree ("status");--> statement-breakpoint
CREATE INDEX "moon_scans_submitted_at_idx" ON "moon_scans" USING btree ("submitted_at");