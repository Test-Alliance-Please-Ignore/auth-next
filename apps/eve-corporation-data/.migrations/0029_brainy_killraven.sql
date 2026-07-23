DROP INDEX "structure_skyhooks_is_raidable_idx";--> statement-breakpoint
ALTER TABLE "structure_sovereignty_hubs" ADD COLUMN "controller_alliance_name" text;--> statement-breakpoint
ALTER TABLE "structure_sovereignty_systems" ADD COLUMN "region_id" text;--> statement-breakpoint
ALTER TABLE "structure_sovereignty_systems" ADD COLUMN "region_name" text;--> statement-breakpoint
ALTER TABLE "structure_sovereignty_systems" ADD COLUMN "alliance_name" text;--> statement-breakpoint
CREATE INDEX "structure_sovereignty_systems_region_id_idx" ON "structure_sovereignty_systems" USING btree ("region_id");--> statement-breakpoint
ALTER TABLE "structure_skyhooks" DROP COLUMN "name";--> statement-breakpoint
ALTER TABLE "structure_skyhooks" DROP COLUMN "is_raidable";--> statement-breakpoint
ALTER TABLE "structure_skyhooks" DROP COLUMN "becomes_raidable_at";--> statement-breakpoint
ALTER TABLE "structure_skyhooks" DROP COLUMN "vulnerable_at";--> statement-breakpoint
ALTER TABLE "structure_sovereignty_hubs" DROP COLUMN "name";