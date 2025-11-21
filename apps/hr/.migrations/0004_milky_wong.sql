CREATE TABLE "application_message_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" varchar(50) DEFAULT 'draft' NOT NULL,
	"template_name" varchar(1024) NOT NULL,
	"owner_corporation_id" text NOT NULL,
	"description" text,
	"message_template" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_message_templates_name" ON "application_message_templates" USING btree ("template_name");--> statement-breakpoint
CREATE INDEX "idx_message_templates_status" ON "application_message_templates" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_message_templates_owner_corporation_id" ON "application_message_templates" USING btree ("owner_corporation_id");