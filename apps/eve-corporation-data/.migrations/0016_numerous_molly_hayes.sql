ALTER TABLE "corporation_structures" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "corporation_structures" ADD COLUMN "type_name" text;--> statement-breakpoint
ALTER TABLE "corporation_structures" ADD COLUMN "system_name" text;--> statement-breakpoint
ALTER TABLE "corporation_structures" ADD COLUMN "region_id" text;--> statement-breakpoint
ALTER TABLE "corporation_structures" ADD COLUMN "region_name" text;--> statement-breakpoint
ALTER TABLE "corporation_structures" ADD COLUMN "fuel_amount" integer;--> statement-breakpoint
ALTER TABLE "corporation_structures" ADD COLUMN "low_power" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "corporation_structures" ADD COLUMN "sync_status" text DEFAULT 'ok' NOT NULL;--> statement-breakpoint
ALTER TABLE "corporation_structures" ADD COLUMN "sync_failure_reason" text;--> statement-breakpoint
ALTER TABLE "corporation_structures" ADD COLUMN "last_synced_at" timestamp with time zone;