CREATE TABLE "application_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"sender_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "application_messages" ADD CONSTRAINT "application_messages_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_messages_app_sender_recipient" ON "application_messages" USING btree ("application_id","sender_id","recipient_id");--> statement-breakpoint
CREATE INDEX "idx_messages_sender_recipient" ON "application_messages" USING btree ("sender_id","recipient_id");--> statement-breakpoint
CREATE INDEX "idx_messages_recipient_sender" ON "application_messages" USING btree ("recipient_id","sender_id");