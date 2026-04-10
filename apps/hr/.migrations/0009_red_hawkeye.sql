CREATE TABLE "application_alts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"character_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "application_alts" ADD CONSTRAINT "application_alts_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_application_alts_app" ON "application_alts" USING btree ("application_id");