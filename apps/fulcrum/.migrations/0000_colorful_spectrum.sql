CREATE TABLE "character_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"character_id" text NOT NULL,
	"character_name" text,
	"status" text NOT NULL,
	"r2_bucket" text,
	"r2_key" text,
	"requestor_user_id" text NOT NULL,
	"requestor_corporation_id" text NOT NULL,
	"workflow_instance_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp,
	"viewed_at" timestamp,
	"error_message" text
);
