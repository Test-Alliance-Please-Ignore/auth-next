CREATE TABLE "admin_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_user_id" uuid NOT NULL,
	"action" text NOT NULL,
	"target_user_id" uuid,
	"target_character_id" text,
	"metadata" jsonb,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"ip" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "user_activity_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"action" varchar(100) NOT NULL,
	"metadata" jsonb,
	"timestamp" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_characters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"character_owner_hash" varchar(255) NOT NULL,
	"character_id" text NOT NULL,
	"character_name" varchar(255) NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"linked_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_characters_character_id_unique" UNIQUE("character_id")
);
--> statement-breakpoint
CREATE TABLE "user_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"session_token" varchar(255) NOT NULL,
	"expires_at" timestamp NOT NULL,
	"metadata" jsonb,
	"last_activity_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_sessions_session_token_unique" UNIQUE("session_token")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"main_character_id" text NOT NULL,
	"discord_user_id" varchar(255),
	"is_admin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_main_character_id_unique" UNIQUE("main_character_id"),
	CONSTRAINT "users_discord_user_id_unique" UNIQUE("discord_user_id")
);
--> statement-breakpoint
ALTER TABLE "user_activity_log" ADD CONSTRAINT "user_activity_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_characters" ADD CONSTRAINT "user_characters_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_audit_log_admin_user_id_idx" ON "admin_audit_log" USING btree ("admin_user_id");--> statement-breakpoint
CREATE INDEX "admin_audit_log_timestamp_idx" ON "admin_audit_log" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "admin_audit_log_action_timestamp_idx" ON "admin_audit_log" USING btree ("action","timestamp");--> statement-breakpoint
CREATE INDEX "admin_audit_log_target_user_id_idx" ON "admin_audit_log" USING btree ("target_user_id");--> statement-breakpoint
CREATE INDEX "admin_audit_log_target_character_id_idx" ON "admin_audit_log" USING btree ("target_character_id");--> statement-breakpoint
CREATE INDEX "user_activity_log_user_id_idx" ON "user_activity_log" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_activity_log_action_idx" ON "user_activity_log" USING btree ("action");--> statement-breakpoint
CREATE INDEX "user_activity_log_timestamp_idx" ON "user_activity_log" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "user_characters_user_id_idx" ON "user_characters" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_characters_character_id_idx" ON "user_characters" USING btree ("character_id");--> statement-breakpoint
CREATE INDEX "user_characters_is_primary_idx" ON "user_characters" USING btree ("user_id","is_primary");--> statement-breakpoint
CREATE INDEX "user_sessions_user_id_idx" ON "user_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_sessions_session_token_idx" ON "user_sessions" USING btree ("session_token");--> statement-breakpoint
CREATE INDEX "user_sessions_expires_at_idx" ON "user_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "users_main_character_id_idx" ON "users" USING btree ("main_character_id");--> statement-breakpoint
CREATE INDEX "users_discord_user_id_idx" ON "users" USING btree ("discord_user_id");