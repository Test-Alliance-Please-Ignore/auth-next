ALTER TABLE "structure_skyhooks" ADD COLUMN "sync_status" text DEFAULT 'ok' NOT NULL;--> statement-breakpoint
ALTER TABLE "structure_skyhooks" ADD COLUMN "sync_failure_reason" text;--> statement-breakpoint
ALTER TABLE "structure_sovereignty_hubs" ADD COLUMN "sync_status" text DEFAULT 'ok' NOT NULL;--> statement-breakpoint
ALTER TABLE "structure_sovereignty_hubs" ADD COLUMN "sync_failure_reason" text;