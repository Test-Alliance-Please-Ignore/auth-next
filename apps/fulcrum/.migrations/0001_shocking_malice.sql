ALTER TABLE "character_reports" ADD COLUMN "request_source" text DEFAULT 'hr' NOT NULL;--> statement-breakpoint
ALTER TABLE "character_reports" ADD COLUMN "application_id" text;--> statement-breakpoint
ALTER TABLE "character_reports" ADD COLUMN "retention_days" integer DEFAULT 7 NOT NULL;