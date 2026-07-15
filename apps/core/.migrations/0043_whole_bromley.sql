CREATE TABLE "service_access_audit_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"main_character_id" text,
	"main_character_name" text,
	"eligible" boolean NOT NULL,
	"reason" text NOT NULL,
	"corporation_ids" text[] DEFAULT '{}' NOT NULL,
	"has_discord_link" boolean DEFAULT false NOT NULL,
	"mumble_status" text DEFAULT 'pending' NOT NULL,
	"mumble_error_message" text,
	"discord_status" text DEFAULT 'pending' NOT NULL,
	"discord_error_message" text,
	"mumble_login_name" text,
	"mumble_display_name" text,
	"mumble_groups" text[],
	"mumble_was_enabled" boolean,
	"discord_roles_removed" text[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_access_audit_rows_run_user_unique" UNIQUE("run_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "service_access_audit_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scan_workflow_instance_id" text,
	"enforce_workflow_instance_id" text,
	"status" text DEFAULT 'scanning' NOT NULL,
	"active_lock" text,
	"initiated_by_user_id" uuid,
	"enforced_by_user_id" uuid,
	"enforce_reason" text,
	"member_corporation_ids" text[] DEFAULT '{}' NOT NULL,
	"member_corp_count" integer DEFAULT 0 NOT NULL,
	"scanned" integer DEFAULT 0 NOT NULL,
	"in_population" integer DEFAULT 0 NOT NULL,
	"eligible_count" integer DEFAULT 0 NOT NULL,
	"ineligible_count" integer DEFAULT 0 NOT NULL,
	"blast_radius_tripped" boolean DEFAULT false NOT NULL,
	"error_message" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"enforce_started_at" timestamp with time zone,
	"enforce_completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_access_audit_runs_scan_workflow_instance_id_unique" UNIQUE("scan_workflow_instance_id"),
	CONSTRAINT "service_access_audit_runs_enforce_workflow_instance_id_unique" UNIQUE("enforce_workflow_instance_id"),
	CONSTRAINT "service_access_audit_runs_active_lock_unique" UNIQUE("active_lock")
);
--> statement-breakpoint
ALTER TABLE "service_access_audit_rows" ADD CONSTRAINT "service_access_audit_rows_run_id_service_access_audit_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."service_access_audit_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_access_audit_rows" ADD CONSTRAINT "service_access_audit_rows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_access_audit_runs" ADD CONSTRAINT "service_access_audit_runs_initiated_by_user_id_users_id_fk" FOREIGN KEY ("initiated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_access_audit_runs" ADD CONSTRAINT "service_access_audit_runs_enforced_by_user_id_users_id_fk" FOREIGN KEY ("enforced_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "service_access_audit_rows_run_eligible_idx" ON "service_access_audit_rows" USING btree ("run_id","eligible");--> statement-breakpoint
CREATE INDEX "service_access_audit_rows_run_reason_idx" ON "service_access_audit_rows" USING btree ("run_id","reason");--> statement-breakpoint
CREATE INDEX "service_access_audit_rows_run_mumble_status_idx" ON "service_access_audit_rows" USING btree ("run_id","mumble_status");--> statement-breakpoint
CREATE INDEX "service_access_audit_rows_run_discord_status_idx" ON "service_access_audit_rows" USING btree ("run_id","discord_status");--> statement-breakpoint
CREATE INDEX "service_access_audit_runs_status_started_idx" ON "service_access_audit_runs" USING btree ("status","started_at");--> statement-breakpoint
CREATE INDEX "service_access_audit_runs_expires_at_idx" ON "service_access_audit_runs" USING btree ("expires_at");