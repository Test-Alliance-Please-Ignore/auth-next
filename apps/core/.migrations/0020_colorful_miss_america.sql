ALTER TABLE "managed_corporations" ADD COLUMN "is_recruiting" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "managed_corporations" ADD COLUMN "short_description" varchar(250);--> statement-breakpoint
ALTER TABLE "managed_corporations" ADD COLUMN "full_description" text;