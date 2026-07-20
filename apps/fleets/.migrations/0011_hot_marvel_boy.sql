DROP INDEX "fleet_state_cache_ended_at_idx";--> statement-breakpoint
ALTER TABLE "fleet_state_cache" DROP COLUMN "is_active";--> statement-breakpoint
ALTER TABLE "fleet_state_cache" DROP COLUMN "ended_at";