CREATE TABLE "legacy_auth_application_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_event_id" text NOT NULL,
	"legacy_application_id" text NOT NULL,
	"legacy_auth_user_id" text,
	"event_type" text NOT NULL,
	"event_code" integer,
	"message" text,
	"legacy_actor_user_id" text,
	"event_at" timestamp with time zone,
	"source_snapshot_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legacy_auth_application_events_legacy_event_id_unique" UNIQUE("legacy_event_id")
);
--> statement-breakpoint
CREATE TABLE "legacy_auth_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_application_id" text NOT NULL,
	"legacy_auth_user_id" text,
	"character_id" text,
	"character_name" text,
	"corporation_id" text,
	"corporation_name" text,
	"status" text,
	"application_date" timestamp with time zone,
	"source_snapshot_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legacy_auth_applications_legacy_application_id_unique" UNIQUE("legacy_application_id")
);
--> statement-breakpoint
CREATE TABLE "legacy_auth_characters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_auth_user_id" text NOT NULL,
	"character_id" text NOT NULL,
	"character_name" text NOT NULL,
	"source" text NOT NULL,
	"source_snapshot_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legacy_auth_characters_legacy_user_character_unique" UNIQUE("legacy_auth_user_id","character_id")
);
--> statement-breakpoint
CREATE TABLE "legacy_auth_discord_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_auth_user_id" text NOT NULL,
	"discord_user_id" text NOT NULL,
	"source_snapshot_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legacy_auth_discord_accounts_legacy_user_discord_user_unique" UNIQUE("legacy_auth_user_id","discord_user_id")
);
--> statement-breakpoint
CREATE TABLE "legacy_auth_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_note_id" text NOT NULL,
	"legacy_auth_user_id" text NOT NULL,
	"legacy_created_by_user_id" text,
	"note" text NOT NULL,
	"legacy_date_created" timestamp with time zone,
	"source_snapshot_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legacy_auth_notes_legacy_note_id_unique" UNIQUE("legacy_note_id")
);
--> statement-breakpoint
CREATE TABLE "legacy_auth_user_ip_addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_auth_user_id" text NOT NULL,
	"ip_address" "inet" NOT NULL,
	"first_seen_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"source_snapshot_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legacy_auth_user_ips_legacy_user_ip_unique" UNIQUE("legacy_auth_user_id","ip_address")
);
--> statement-breakpoint
CREATE TABLE "legacy_migration_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"queue_id" uuid NOT NULL,
	"action" text NOT NULL,
	"performed_by_user_id" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legacy_migration_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"modern_user_id" text NOT NULL,
	"legacy_auth_user_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"severity" text DEFAULT 'none' NOT NULL,
	"candidate_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"conflicts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_error" text,
	"last_matched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legacy_migration_queue_modern_user_legacy_user_unique" UNIQUE("modern_user_id","legacy_auth_user_id")
);
--> statement-breakpoint
ALTER TABLE "legacy_migration_actions" ADD CONSTRAINT "legacy_migration_actions_queue_id_legacy_migration_queue_id_fk" FOREIGN KEY ("queue_id") REFERENCES "public"."legacy_migration_queue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "legacy_auth_application_events_app_idx" ON "legacy_auth_application_events" USING btree ("legacy_application_id");--> statement-breakpoint
CREATE INDEX "legacy_auth_application_events_legacy_user_idx" ON "legacy_auth_application_events" USING btree ("legacy_auth_user_id");--> statement-breakpoint
CREATE INDEX "legacy_auth_application_events_event_at_idx" ON "legacy_auth_application_events" USING btree ("event_at");--> statement-breakpoint
CREATE INDEX "legacy_auth_application_events_event_code_idx" ON "legacy_auth_application_events" USING btree ("event_code");--> statement-breakpoint
CREATE INDEX "legacy_auth_applications_legacy_user_idx" ON "legacy_auth_applications" USING btree ("legacy_auth_user_id");--> statement-breakpoint
CREATE INDEX "legacy_auth_applications_character_id_idx" ON "legacy_auth_applications" USING btree ("character_id");--> statement-breakpoint
CREATE INDEX "legacy_auth_applications_status_idx" ON "legacy_auth_applications" USING btree ("status");--> statement-breakpoint
CREATE INDEX "legacy_auth_applications_date_idx" ON "legacy_auth_applications" USING btree ("application_date");--> statement-breakpoint
CREATE INDEX "legacy_auth_characters_legacy_user_idx" ON "legacy_auth_characters" USING btree ("legacy_auth_user_id");--> statement-breakpoint
CREATE INDEX "legacy_auth_characters_character_id_idx" ON "legacy_auth_characters" USING btree ("character_id");--> statement-breakpoint
CREATE INDEX "legacy_auth_characters_source_idx" ON "legacy_auth_characters" USING btree ("source");--> statement-breakpoint
CREATE INDEX "legacy_auth_discord_accounts_legacy_user_idx" ON "legacy_auth_discord_accounts" USING btree ("legacy_auth_user_id");--> statement-breakpoint
CREATE INDEX "legacy_auth_discord_accounts_discord_user_idx" ON "legacy_auth_discord_accounts" USING btree ("discord_user_id");--> statement-breakpoint
CREATE INDEX "legacy_auth_notes_legacy_user_idx" ON "legacy_auth_notes" USING btree ("legacy_auth_user_id");--> statement-breakpoint
CREATE INDEX "legacy_auth_notes_created_by_idx" ON "legacy_auth_notes" USING btree ("legacy_created_by_user_id");--> statement-breakpoint
CREATE INDEX "legacy_auth_notes_legacy_created_idx" ON "legacy_auth_notes" USING btree ("legacy_date_created");--> statement-breakpoint
CREATE INDEX "legacy_auth_user_ips_legacy_user_idx" ON "legacy_auth_user_ip_addresses" USING btree ("legacy_auth_user_id");--> statement-breakpoint
CREATE INDEX "legacy_auth_user_ips_ip_address_idx" ON "legacy_auth_user_ip_addresses" USING btree ("ip_address");--> statement-breakpoint
CREATE INDEX "legacy_migration_actions_queue_idx" ON "legacy_migration_actions" USING btree ("queue_id");--> statement-breakpoint
CREATE INDEX "legacy_migration_actions_action_idx" ON "legacy_migration_actions" USING btree ("action");--> statement-breakpoint
CREATE INDEX "legacy_migration_actions_performed_by_idx" ON "legacy_migration_actions" USING btree ("performed_by_user_id");--> statement-breakpoint
CREATE INDEX "legacy_migration_queue_modern_user_idx" ON "legacy_migration_queue" USING btree ("modern_user_id");--> statement-breakpoint
CREATE INDEX "legacy_migration_queue_legacy_user_idx" ON "legacy_migration_queue" USING btree ("legacy_auth_user_id");--> statement-breakpoint
CREATE INDEX "legacy_migration_queue_status_idx" ON "legacy_migration_queue" USING btree ("status");--> statement-breakpoint
CREATE INDEX "legacy_migration_queue_severity_idx" ON "legacy_migration_queue" USING btree ("severity");