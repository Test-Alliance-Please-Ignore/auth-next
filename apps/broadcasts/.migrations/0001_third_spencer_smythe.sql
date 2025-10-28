-- Add column as nullable first
ALTER TABLE "broadcasts" ADD COLUMN "created_by_character_name" varchar(255);--> statement-breakpoint
-- Update existing rows with a default value
UPDATE "broadcasts" SET "created_by_character_name" = 'Unknown' WHERE "created_by_character_name" IS NULL;--> statement-breakpoint
-- Make it NOT NULL
ALTER TABLE "broadcasts" ALTER COLUMN "created_by_character_name" SET NOT NULL;