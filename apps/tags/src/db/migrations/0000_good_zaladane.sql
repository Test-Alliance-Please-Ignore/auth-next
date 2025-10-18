CREATE TABLE "tags_evaluation_schedule" (
	"root_user_id" uuid PRIMARY KEY NOT NULL,
	"next_evaluation_at" timestamp NOT NULL,
	"last_evaluated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tags_tags" (
	"tag_urn" varchar(255) PRIMARY KEY NOT NULL,
	"tag_type" varchar(50) NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"eve_id" integer,
	"metadata" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tags_user_tags" (
	"assignment_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"root_user_id" uuid NOT NULL,
	"tag_urn" varchar(255) NOT NULL,
	"source_character_id" integer,
	"assigned_at" timestamp DEFAULT now() NOT NULL,
	"last_verified_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "tags_eval_schedule_next_idx" ON "tags_evaluation_schedule" USING btree ("next_evaluation_at");--> statement-breakpoint
CREATE INDEX "tags_tags_type_idx" ON "tags_tags" USING btree ("tag_type");--> statement-breakpoint
CREATE INDEX "tags_tags_eve_id_idx" ON "tags_tags" USING btree ("eve_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tags_user_tags_unique_idx" ON "tags_user_tags" USING btree ("root_user_id","tag_urn","source_character_id");--> statement-breakpoint
CREATE INDEX "tags_user_tags_user_idx" ON "tags_user_tags" USING btree ("root_user_id");--> statement-breakpoint
CREATE INDEX "tags_user_tags_tag_idx" ON "tags_user_tags" USING btree ("tag_urn");--> statement-breakpoint
CREATE INDEX "tags_user_tags_source_idx" ON "tags_user_tags" USING btree ("source_character_id");