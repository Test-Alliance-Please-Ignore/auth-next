CREATE TABLE "discord_member_audit_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"discord_user_id" text NOT NULL,
	"username" text NOT NULL,
	"discriminator" text NOT NULL,
	"display_name" text NOT NULL,
	"role_ids" text[] DEFAULT '{}' NOT NULL,
	"linked" boolean NOT NULL,
	"core_user_id" uuid,
	"main_character_id" text,
	"main_character_name" text,
	"has_valid_token" boolean,
	"corporation_id" text,
	"corporation_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discord_member_audit_rows_run_discord_user_unique" UNIQUE("run_id","discord_user_id")
);
--> statement-breakpoint
CREATE TABLE "discord_member_audit_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_instance_id" text NOT NULL,
	"discord_server_id" uuid NOT NULL,
	"guild_id" text NOT NULL,
	"guild_name" text NOT NULL,
	"initiated_by_user_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"scanned" integer DEFAULT 0 NOT NULL,
	"linked_count" integer DEFAULT 0 NOT NULL,
	"unlinked_count" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discord_member_audit_runs_workflow_instance_id_unique" UNIQUE("workflow_instance_id")
);
--> statement-breakpoint
ALTER TABLE "discord_member_audit_rows" ADD CONSTRAINT "discord_member_audit_rows_run_id_discord_member_audit_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."discord_member_audit_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_member_audit_rows" ADD CONSTRAINT "discord_member_audit_rows_core_user_id_users_id_fk" FOREIGN KEY ("core_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_member_audit_runs" ADD CONSTRAINT "discord_member_audit_runs_discord_server_id_discord_servers_id_fk" FOREIGN KEY ("discord_server_id") REFERENCES "public"."discord_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_member_audit_runs" ADD CONSTRAINT "discord_member_audit_runs_initiated_by_user_id_users_id_fk" FOREIGN KEY ("initiated_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "discord_member_audit_rows_run_linked_user_idx" ON "discord_member_audit_rows" USING btree ("run_id","linked","discord_user_id");--> statement-breakpoint
CREATE INDEX "discord_member_audit_runs_server_started_idx" ON "discord_member_audit_runs" USING btree ("discord_server_id","started_at");--> statement-breakpoint
CREATE INDEX "discord_member_audit_runs_status_idx" ON "discord_member_audit_runs" USING btree ("status");