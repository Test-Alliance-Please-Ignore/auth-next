CREATE TYPE "public"."bill_notification_event_type" AS ENUM('issued', 'due_24h', 'overdue', 'paid');--> statement-breakpoint
CREATE TYPE "public"."bill_notification_status" AS ENUM('pending', 'sent', 'failed', 'skipped');--> statement-breakpoint
CREATE TABLE "bill_notification_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bill_id" uuid NOT NULL,
	"recipient_user_id" text NOT NULL,
	"event_type" "bill_notification_event_type" NOT NULL,
	"status" "bill_notification_status" DEFAULT 'pending' NOT NULL,
	"first_eligible_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"workflow_instance_id" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bill_notification_events_unique" UNIQUE("bill_id","recipient_user_id","event_type")
);
--> statement-breakpoint
ALTER TABLE "bill_notification_events" ADD CONSTRAINT "bill_notification_events_bill_id_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bill_notification_events_bill_id_idx" ON "bill_notification_events" USING btree ("bill_id");--> statement-breakpoint
CREATE INDEX "bill_notification_events_recipient_user_id_idx" ON "bill_notification_events" USING btree ("recipient_user_id");--> statement-breakpoint
CREATE INDEX "bill_notification_events_event_type_idx" ON "bill_notification_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "bill_notification_events_status_idx" ON "bill_notification_events" USING btree ("status");--> statement-breakpoint
CREATE INDEX "bill_notification_events_first_eligible_at_idx" ON "bill_notification_events" USING btree ("first_eligible_at");