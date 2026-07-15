CREATE TABLE "structure_moon_geographies" (
	"structure_id" text PRIMARY KEY NOT NULL,
	"corporation_id" text NOT NULL,
	"moon_id" text NOT NULL,
	"moon_name" text,
	"planet_id" text NOT NULL,
	"planet_name" text,
	"system_id" text NOT NULL,
	"system_name" text,
	"source_sync_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "structure_mining_citadel_extractions_moon_id_idx";--> statement-breakpoint
DROP INDEX "structure_mining_citadel_extractions_planet_id_idx";--> statement-breakpoint
DROP INDEX "structure_mining_citadel_extractions_system_id_idx";--> statement-breakpoint
DROP INDEX "structure_moon_drills_moon_id_idx";--> statement-breakpoint
DROP INDEX "structure_moon_drills_planet_id_idx";--> statement-breakpoint
DROP INDEX "structure_moon_drills_system_id_idx";--> statement-breakpoint
ALTER TABLE "structure_moon_geographies" ADD CONSTRAINT "structure_moon_geographies_structure_id_corporation_structures_structure_id_fk" FOREIGN KEY ("structure_id") REFERENCES "public"."corporation_structures"("structure_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "structure_moon_geographies" ADD CONSTRAINT "structure_moon_geographies_corporation_id_managed_corporations_corporation_id_fk" FOREIGN KEY ("corporation_id") REFERENCES "public"."managed_corporations"("corporation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "structure_moon_geographies_corporation_id_idx" ON "structure_moon_geographies" USING btree ("corporation_id");--> statement-breakpoint
CREATE INDEX "structure_moon_geographies_moon_id_idx" ON "structure_moon_geographies" USING btree ("moon_id");--> statement-breakpoint
CREATE INDEX "structure_moon_geographies_planet_id_idx" ON "structure_moon_geographies" USING btree ("planet_id");--> statement-breakpoint
CREATE INDEX "structure_moon_geographies_system_id_idx" ON "structure_moon_geographies" USING btree ("system_id");--> statement-breakpoint
CREATE INDEX "structure_moon_geographies_last_synced_at_idx" ON "structure_moon_geographies" USING btree ("last_synced_at");--> statement-breakpoint
ALTER TABLE "structure_mining_citadel_extractions" DROP COLUMN "moon_id";--> statement-breakpoint
ALTER TABLE "structure_mining_citadel_extractions" DROP COLUMN "moon_name";--> statement-breakpoint
ALTER TABLE "structure_mining_citadel_extractions" DROP COLUMN "planet_id";--> statement-breakpoint
ALTER TABLE "structure_mining_citadel_extractions" DROP COLUMN "planet_name";--> statement-breakpoint
ALTER TABLE "structure_mining_citadel_extractions" DROP COLUMN "system_id";--> statement-breakpoint
ALTER TABLE "structure_mining_citadel_extractions" DROP COLUMN "system_name";--> statement-breakpoint
ALTER TABLE "structure_moon_drills" DROP COLUMN "moon_id";--> statement-breakpoint
ALTER TABLE "structure_moon_drills" DROP COLUMN "moon_name";--> statement-breakpoint
ALTER TABLE "structure_moon_drills" DROP COLUMN "planet_id";--> statement-breakpoint
ALTER TABLE "structure_moon_drills" DROP COLUMN "planet_name";--> statement-breakpoint
ALTER TABLE "structure_moon_drills" DROP COLUMN "system_id";--> statement-breakpoint
ALTER TABLE "structure_moon_drills" DROP COLUMN "system_name";