ALTER TABLE "blacklist_entries" ALTER COLUMN "target_type" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."blacklist_target_type";--> statement-breakpoint
CREATE TYPE "public"."blacklist_target_type" AS ENUM('user', 'character_id', 'character_name', 'discord_id', 'corporation_id', 'corporation_name', 'alliance_id', 'alliance_name');--> statement-breakpoint
ALTER TABLE "blacklist_entries" ALTER COLUMN "target_type" SET DATA TYPE "public"."blacklist_target_type" USING "target_type"::"public"."blacklist_target_type";--> statement-breakpoint
DROP INDEX "idx_blacklist_user";--> statement-breakpoint
DROP INDEX "idx_blacklist_character";--> statement-breakpoint
ALTER TABLE "blacklist_entries" ALTER COLUMN "target_value" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "blacklist_entries" DROP COLUMN "user_id";--> statement-breakpoint
ALTER TABLE "blacklist_entries" DROP COLUMN "character_id";