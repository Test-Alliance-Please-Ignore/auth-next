CREATE TABLE "srp_payment_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"kind" varchar(64) DEFAULT 'payment_mismatch' NOT NULL,
	"state" varchar(32) DEFAULT 'open' NOT NULL,
	"journal_id" text NOT NULL,
	"expected_amount" text NOT NULL,
	"observed_amount" text NOT NULL,
	"expected_recipient_character_id" text NOT NULL,
	"expected_recipient_character_name" varchar(255),
	"actual_recipient_character_id" text,
	"actual_recipient_character_name" varchar(255),
	"actual_payer_id" text,
	"actual_payer_name" varchar(255),
	"reason" text,
	"payment_processor_corporation_id" text,
	"metadata" jsonb,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by_user_id" uuid,
	"acknowledged_by_character_name" varchar(255)
);
--> statement-breakpoint
ALTER TABLE "srp_payment_alerts" ADD CONSTRAINT "srp_payment_alerts_request_id_srp_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."srp_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "srp_payment_alerts_request_journal_observed_uq" ON "srp_payment_alerts" USING btree ("request_id","journal_id","observed_amount");--> statement-breakpoint
CREATE INDEX "srp_payment_alerts_state_detected_idx" ON "srp_payment_alerts" USING btree ("state","detected_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "srp_payment_alerts_request_state_idx" ON "srp_payment_alerts" USING btree ("request_id","state");--> statement-breakpoint
CREATE INDEX "srp_payment_alerts_detected_at_idx" ON "srp_payment_alerts" USING btree ("detected_at" DESC NULLS LAST);