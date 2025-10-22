ALTER TABLE "managed_corporations" ALTER COLUMN "corporation_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "managed_corporations" ALTER COLUMN "assigned_character_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "user_characters" ALTER COLUMN "character_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "main_character_id" SET DATA TYPE text;