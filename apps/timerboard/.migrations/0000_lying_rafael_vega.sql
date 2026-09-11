CREATE TABLE "timerboard_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"action" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "timerboard_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category" text NOT NULL,
	"timer_type" text DEFAULT 'custom' NOT NULL,
	"title" varchar(160) NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"hostility" text DEFAULT 'unknown' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"state" text DEFAULT 'planned' NOT NULL,
	"system_id" text,
	"system_name" varchar(120),
	"region_id" text,
	"region_name" varchar(120),
	"planet_id" text,
	"planet_name" varchar(120),
	"moon_id" text,
	"moon_name" varchar(120),
	"corporation_id" text,
	"corporation_name" varchar(160),
	"alliance_id" text,
	"alliance_name" varchar(160),
	"structure_visibility_enforced" boolean DEFAULT false NOT NULL,
	"sharing_enabled" boolean DEFAULT false NOT NULL,
	"share_destinations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"subject_id" text,
	"subject_type" varchar(80),
	"subject_name" varchar(160),
	"assigned_user_id" uuid,
	"assigned_character_id" text,
	"assigned_character_name" varchar(255),
	"notes" varchar(2000),
	"source_kind" text DEFAULT 'manual' NOT NULL,
	"source_reference" text,
	"created_by_user_id" uuid NOT NULL,
	"updated_by_user_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "timerboard_entry_destination_sync" (
	"entry_id" uuid NOT NULL,
	"adapter_key" varchar(80) NOT NULL,
	"target_key" varchar(255) NOT NULL,
	"remote_id" varchar(255),
	"remote_version" varchar(255),
	"state" text DEFAULT 'pending' NOT NULL,
	"last_error" varchar(2000),
	"retry_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"lease_until" timestamp with time zone,
	"idempotency_key" varchar(255) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "timerboard_entry_destination_sync_entry_id_adapter_key_target_key_pk" PRIMARY KEY("entry_id","adapter_key","target_key")
);
--> statement-breakpoint
CREATE TABLE "timerboard_entry_visibility_groups" (
	"entry_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "timerboard_entry_visibility_groups_entry_id_group_id_pk" PRIMARY KEY("entry_id","group_id")
);
--> statement-breakpoint
CREATE TABLE "timerboard_sync_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"operation" text NOT NULL,
	"version" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_until" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"last_error" varchar(2000),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "timerboard_activity" ADD CONSTRAINT "timerboard_activity_entry_id_timerboard_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."timerboard_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timerboard_activity" ADD CONSTRAINT "timerboard_activity_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timerboard_entries" ADD CONSTRAINT "timerboard_entries_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timerboard_entries" ADD CONSTRAINT "timerboard_entries_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timerboard_entries" ADD CONSTRAINT "timerboard_entries_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timerboard_entry_destination_sync" ADD CONSTRAINT "timerboard_entry_destination_sync_entry_id_timerboard_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."timerboard_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timerboard_entry_visibility_groups" ADD CONSTRAINT "timerboard_entry_visibility_groups_entry_id_timerboard_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."timerboard_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timerboard_sync_outbox" ADD CONSTRAINT "timerboard_sync_outbox_entry_id_timerboard_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."timerboard_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "timerboard_activity_entry_created_at_idx" ON "timerboard_activity" USING btree ("entry_id","created_at");--> statement-breakpoint
CREATE INDEX "timerboard_entries_state_starts_at_idx" ON "timerboard_entries" USING btree ("state","starts_at");--> statement-breakpoint
CREATE INDEX "timerboard_entries_updated_at_idx" ON "timerboard_entries" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "timerboard_entries_assigned_user_id_idx" ON "timerboard_entries" USING btree ("assigned_user_id");--> statement-breakpoint
CREATE INDEX "timerboard_entries_structure_visibility_idx" ON "timerboard_entries" USING btree ("structure_visibility_enforced");--> statement-breakpoint
CREATE INDEX "timerboard_destination_sync_claim_idx" ON "timerboard_entry_destination_sync" USING btree ("state","next_attempt_at");--> statement-breakpoint
CREATE INDEX "timerboard_visibility_groups_group_idx" ON "timerboard_entry_visibility_groups" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "timerboard_sync_outbox_claim_idx" ON "timerboard_sync_outbox" USING btree ("completed_at","available_at");