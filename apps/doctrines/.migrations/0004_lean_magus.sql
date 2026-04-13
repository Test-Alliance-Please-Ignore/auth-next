ALTER TABLE "doctrines_fittings" ADD COLUMN "name" text;--> statement-breakpoint
UPDATE "doctrines_fittings" SET "name" = "ship_name" WHERE "name" IS NULL;--> statement-breakpoint
ALTER TABLE "doctrines_fittings" ALTER COLUMN "name" SET NOT NULL;