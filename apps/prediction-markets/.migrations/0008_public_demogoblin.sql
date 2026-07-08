ALTER TYPE "public"."pm_ledger_type" ADD VALUE 'creator_reward';--> statement-breakpoint
ALTER TABLE "pm_config" ADD COLUMN "creator_reward_min_bps" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pm_config" ADD COLUMN "creator_reward_max_bps" integer DEFAULT 0 NOT NULL;