CREATE TYPE "public"."bill_status_event_type" AS ENUM('created', 'issued', 'payment_recorded', 'paid', 'cancelled', 'overdue', 'payment_token_regenerated');--> statement-breakpoint
CREATE TABLE "bill_status_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bill_id" uuid NOT NULL,
	"event_type" "bill_status_event_type" NOT NULL,
	"from_status" "bill_status",
	"to_status" "bill_status",
	"actor_user_id" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "external_source_type" text;--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "external_source_id" text;--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "external_metadata" jsonb;--> statement-breakpoint
ALTER TABLE "bill_status_events" ADD CONSTRAINT "bill_status_events_bill_id_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bill_status_events_bill_id_idx" ON "bill_status_events" USING btree ("bill_id");--> statement-breakpoint
CREATE INDEX "bill_status_events_event_type_idx" ON "bill_status_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "bill_status_events_created_at_idx" ON "bill_status_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "bills_external_source_type_idx" ON "bills" USING btree ("external_source_type");--> statement-breakpoint
CREATE INDEX "bills_external_source_id_idx" ON "bills" USING btree ("external_source_id");--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_external_source_unique" UNIQUE("external_source_type","external_source_id");