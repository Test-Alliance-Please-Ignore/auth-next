DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_type t
		JOIN pg_namespace n ON n.oid = t.typnamespace
		WHERE t.typname = 'bill_status_event_type'
			AND n.nspname = 'public'
	) THEN
		CREATE TYPE "public"."bill_status_event_type" AS ENUM(
			'created',
			'issued',
			'payment_recorded',
			'paid',
			'cancelled',
			'overdue',
			'payment_token_regenerated'
		);
	END IF;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "bill_status_events" (
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

DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conname = 'bill_status_events_bill_id_bills_id_fk'
	) THEN
		ALTER TABLE "bill_status_events"
		ADD CONSTRAINT "bill_status_events_bill_id_bills_id_fk"
		FOREIGN KEY ("bill_id")
		REFERENCES "public"."bills"("id")
		ON DELETE cascade
		ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "bill_status_events_bill_id_idx"
	ON "bill_status_events" USING btree ("bill_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bill_status_events_event_type_idx"
	ON "bill_status_events" USING btree ("event_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bill_status_events_created_at_idx"
	ON "bill_status_events" USING btree ("created_at");
