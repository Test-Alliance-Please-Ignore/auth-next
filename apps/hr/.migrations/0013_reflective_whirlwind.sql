CREATE TABLE "application_staff_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"author_character_id" text,
	"author_character_name" varchar(255),
	"note_text" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "last_staff_interaction_at" timestamp;--> statement-breakpoint
ALTER TABLE "application_staff_notes" ADD CONSTRAINT "application_staff_notes_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_application_staff_notes_app_created" ON "application_staff_notes" USING btree ("application_id","created_at" DESC NULLS LAST);