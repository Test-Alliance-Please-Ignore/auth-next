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
	"kind" text NOT NULL,
	"title" varchar(160) NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"side" text DEFAULT 'unknown' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"state" text DEFAULT 'planned' NOT NULL,
	"system_id" text,
	"system_name" varchar(120),
	"entity_id" text,
	"entity_type" varchar(80),
	"entity_name" varchar(160),
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
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "timerboard_entries_window_check" CHECK ("timerboard_entries"."ends_at" IS NULL OR "timerboard_entries"."ends_at" > "timerboard_entries"."starts_at")
);
--> statement-breakpoint
ALTER TABLE "timerboard_activity" ADD CONSTRAINT "timerboard_activity_entry_id_timerboard_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."timerboard_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timerboard_activity" ADD CONSTRAINT "timerboard_activity_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timerboard_entries" ADD CONSTRAINT "timerboard_entries_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timerboard_entries" ADD CONSTRAINT "timerboard_entries_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timerboard_entries" ADD CONSTRAINT "timerboard_entries_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "timerboard_activity_entry_created_at_idx" ON "timerboard_activity" USING btree ("entry_id","created_at");--> statement-breakpoint
CREATE INDEX "timerboard_entries_state_starts_at_idx" ON "timerboard_entries" USING btree ("state","starts_at");--> statement-breakpoint
CREATE INDEX "timerboard_entries_updated_at_idx" ON "timerboard_entries" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "timerboard_entries_assigned_user_id_idx" ON "timerboard_entries" USING btree ("assigned_user_id");