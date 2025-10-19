-- Drop the unique constraint if it exists
ALTER TABLE "user_characters" DROP CONSTRAINT IF EXISTS "user_characters_user_primary_unique";--> statement-breakpoint
-- Convert is_primary from timestamp to boolean (NULL -> false, non-NULL -> true)
ALTER TABLE "user_characters" ALTER COLUMN "is_primary" SET DATA TYPE boolean USING (CASE WHEN "is_primary" IS NULL THEN false ELSE true END);--> statement-breakpoint
ALTER TABLE "user_characters" ALTER COLUMN "is_primary" SET DEFAULT false;--> statement-breakpoint
ALTER TABLE "user_characters" ALTER COLUMN "is_primary" SET NOT NULL;--> statement-breakpoint
-- Convert is_admin from timestamp to boolean (NULL -> false, non-NULL -> true)
ALTER TABLE "users" ALTER COLUMN "is_admin" SET DATA TYPE boolean USING (CASE WHEN "is_admin" IS NULL THEN false ELSE true END);--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "is_admin" SET DEFAULT false;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "is_admin" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "user_characters_is_primary_idx" ON "user_characters" USING btree ("user_id","is_primary");
