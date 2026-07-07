CREATE TABLE "user_feature_flags" (
	"id" text PRIMARY KEY NOT NULL,
	"feature_flag_id" text NOT NULL,
	"user_id" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_feature_flags" ADD CONSTRAINT "user_feature_flags_feature_flag_id_feature_flags_id_fk" FOREIGN KEY ("feature_flag_id") REFERENCES "public"."feature_flags"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_feature_flags_pk" ON "user_feature_flags" USING btree ("feature_flag_id","user_id");--> statement-breakpoint
CREATE INDEX "user_feature_flags_user_id_enabled_idx" ON "user_feature_flags" USING btree ("user_id","enabled");--> statement-breakpoint
CREATE INDEX "user_feature_flags_feature_flag_id_enabled_idx" ON "user_feature_flags" USING btree ("feature_flag_id","enabled");