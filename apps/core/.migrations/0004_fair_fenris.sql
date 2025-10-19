ALTER TABLE "user_characters" DROP CONSTRAINT IF EXISTS "user_characters_character_owner_hash_unique";--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_main_character_owner_hash_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "user_characters_character_owner_hash_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "users_main_character_owner_hash_idx";--> statement-breakpoint
-- Add column as nullable first
ALTER TABLE "users" ADD COLUMN "main_character_id" bigint;--> statement-breakpoint
-- Backfill main_character_id from primary character
UPDATE "users" u SET "main_character_id" = (SELECT uc."character_id" FROM "user_characters" uc WHERE uc."user_id" = u."id" AND uc."is_primary" = true LIMIT 1);--> statement-breakpoint
-- Now set NOT NULL after backfill
ALTER TABLE "users" ALTER COLUMN "main_character_id" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "user_characters_character_id_idx" ON "user_characters" USING btree ("character_id");--> statement-breakpoint
CREATE INDEX "users_main_character_id_idx" ON "users" USING btree ("main_character_id");--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "main_character_owner_hash";--> statement-breakpoint
ALTER TABLE "user_characters" ADD CONSTRAINT "user_characters_character_id_unique" UNIQUE("character_id");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_main_character_id_unique" UNIQUE("main_character_id");