DROP INDEX "structure_mining_states_type_id_idx";--> statement-breakpoint
ALTER TABLE "structure_mining_states" ALTER COLUMN "planet_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "structure_mining_states" ALTER COLUMN "system_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "structure_skyhook_states" ALTER COLUMN "planet_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "structure_skyhook_states" ALTER COLUMN "system_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "structure_mining_states" ADD COLUMN "moon_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "structure_mining_states" ADD COLUMN "moon_name" text;--> statement-breakpoint
ALTER TABLE "structure_mining_states" ADD COLUMN "planet_name" text;--> statement-breakpoint
ALTER TABLE "structure_mining_states" ADD COLUMN "system_name" text;--> statement-breakpoint
ALTER TABLE "structure_mining_states" ADD COLUMN "extraction_start_time" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "structure_mining_states" ADD COLUMN "chunk_arrival_time" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "structure_mining_states" ADD COLUMN "natural_decay_time" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "structure_skyhook_states" ADD COLUMN "planet_name" text;--> statement-breakpoint
ALTER TABLE "structure_skyhook_states" ADD COLUMN "system_name" text;--> statement-breakpoint
ALTER TABLE "structure_sovereignty_hubs" ADD COLUMN "system_name" text;--> statement-breakpoint
ALTER TABLE "structure_sovereignty_systems" ADD COLUMN "system_name" text;--> statement-breakpoint
CREATE INDEX "structure_mining_states_moon_id_idx" ON "structure_mining_states" USING btree ("moon_id");--> statement-breakpoint
CREATE INDEX "structure_mining_states_planet_id_idx" ON "structure_mining_states" USING btree ("planet_id");--> statement-breakpoint
ALTER TABLE "structure_mining_states" DROP COLUMN "type_id";--> statement-breakpoint
ALTER TABLE "structure_mining_states" DROP COLUMN "current_stock_volume";--> statement-breakpoint
ALTER TABLE "structure_mining_states" DROP COLUMN "capacity_volume";--> statement-breakpoint
ALTER TABLE "structure_mining_states" DROP COLUMN "fill_rate_per_hour";--> statement-breakpoint
ALTER TABLE "structure_mining_states" DROP COLUMN "last_emptied_at";--> statement-breakpoint
ALTER TABLE "structure_mining_states" DROP COLUMN "estimated_full_at";--> statement-breakpoint
ALTER TABLE "structure_mining_states" DROP COLUMN "last_observed_volume";--> statement-breakpoint
ALTER TABLE "structure_mining_states" DROP COLUMN "last_observed_at";