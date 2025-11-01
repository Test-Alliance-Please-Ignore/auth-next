CREATE TABLE "application_activity_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"character_id" text NOT NULL,
	"action" varchar(100) NOT NULL,
	"previous_value" text,
	"new_value" text,
	"metadata" jsonb,
	"timestamp" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "application_recommendations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"character_id" text NOT NULL,
	"character_name" varchar(255) NOT NULL,
	"recommendation_text" text NOT NULL,
	"sentiment" varchar(20) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_recommendations_app_user" UNIQUE("application_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"corporation_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"character_id" text NOT NULL,
	"character_name" varchar(255) NOT NULL,
	"application_text" text NOT NULL,
	"status" varchar(50) DEFAULT 'pending' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp,
	"review_notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_user_id" uuid NOT NULL,
	"subject_character_id" text,
	"author_id" uuid NOT NULL,
	"author_character_id" text,
	"author_character_name" varchar(255),
	"note_text" text NOT NULL,
	"note_type" varchar(50) NOT NULL,
	"priority" varchar(20) DEFAULT 'normal' NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"corporation_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"character_id" text NOT NULL,
	"character_name" varchar(255) NOT NULL,
	"role" varchar(50) NOT NULL,
	"granted_by" uuid NOT NULL,
	"granted_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_activity_log_app_timestamp" ON "application_activity_log" USING btree ("application_id","timestamp" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_activity_log_timestamp" ON "application_activity_log" USING btree ("timestamp" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_recommendations_app_created" ON "application_recommendations" USING btree ("application_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_applications_corp_status_created" ON "applications" USING btree ("corporation_id","status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_applications_user_created" ON "applications" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_applications_character_name" ON "applications" USING btree ("character_name");--> statement-breakpoint
CREATE INDEX "idx_hr_notes_subject_user_created" ON "hr_notes" USING btree ("subject_user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_hr_notes_subject_char_created" ON "hr_notes" USING btree ("subject_character_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_hr_notes_priority_created" ON "hr_notes" USING btree ("priority","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_hr_roles_user_active" ON "hr_roles" USING btree ("user_id","is_active");--> statement-breakpoint
CREATE INDEX "idx_hr_roles_corp_user" ON "hr_roles" USING btree ("corporation_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_hr_roles_expired" ON "hr_roles" USING btree ("expires_at");