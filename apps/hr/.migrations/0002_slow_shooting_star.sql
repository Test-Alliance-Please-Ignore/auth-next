CREATE TABLE "blacklist_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_type" varchar(20) NOT NULL,
	"user_id" uuid,
	"character_id" text,
	"reason" text NOT NULL,
	"blacklisted_by" uuid NOT NULL,
	"triggered_by" uuid,
	"is_auto_blacklist" boolean DEFAULT false NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_blacklist_user" ON "blacklist_entries" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_blacklist_character" ON "blacklist_entries" USING btree ("character_id");--> statement-breakpoint
CREATE INDEX "idx_blacklist_triggered_by" ON "blacklist_entries" USING btree ("triggered_by");--> statement-breakpoint
CREATE INDEX "idx_blacklist_type_auto" ON "blacklist_entries" USING btree ("target_type","is_auto_blacklist");--> statement-breakpoint
CREATE INDEX "idx_blacklist_created" ON "blacklist_entries" USING btree ("created_at" DESC NULLS LAST);