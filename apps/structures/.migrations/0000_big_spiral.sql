CREATE TABLE "structure_configs" (
	"structure_id" text PRIMARY KEY NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"low_power_allowed" boolean DEFAULT false NOT NULL,
	"assigned_group_id" text,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "structure_corporation_group_defaults" (
	"corporation_id" text PRIMARY KEY NOT NULL,
	"group_id" text,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "structure_group_alert_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" text NOT NULL,
	"alert_type" text NOT NULL,
	"destination_ids" uuid[] DEFAULT '{}' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "structure_group_alert_configs_group_alert_type_unique" UNIQUE("group_id","alert_type")
);
--> statement-breakpoint
CREATE TABLE "structure_group_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" text NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "structure_group_settings_group_id_unique" UNIQUE("group_id")
);
--> statement-breakpoint
CREATE TABLE "structure_module_config" (
	"id" text PRIMARY KEY NOT NULL,
	"low_fuel_time_threshold_hours" integer DEFAULT 12 NOT NULL,
	"critical_fuel_time_threshold_hours" integer DEFAULT 4 NOT NULL,
	"low_fuel_amount_threshold" integer DEFAULT 0 NOT NULL,
	"critical_fuel_amount_threshold" integer DEFAULT 0 NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "structure_state_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"structure_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"previous_state" text NOT NULL,
	"new_state" text NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source_sync_at" timestamp with time zone,
	"raw_payload" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "structure_configs" ADD CONSTRAINT "structure_configs_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "structure_corporation_group_defaults" ADD CONSTRAINT "structure_corporation_group_defaults_corporation_id_managed_corporations_corporation_id_fk" FOREIGN KEY ("corporation_id") REFERENCES "public"."managed_corporations"("corporation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "structure_corporation_group_defaults" ADD CONSTRAINT "structure_corporation_group_defaults_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "structure_group_settings" ADD CONSTRAINT "structure_group_settings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "structure_group_settings" ADD CONSTRAINT "structure_group_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "structure_module_config" ADD CONSTRAINT "structure_module_config_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "structure_state_events" ADD CONSTRAINT "structure_state_events_owner_id_managed_corporations_corporation_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."managed_corporations"("corporation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "structure_configs_assigned_group_idx" ON "structure_configs" USING btree ("assigned_group_id");--> statement-breakpoint
CREATE INDEX "structure_corporation_group_defaults_group_id_idx" ON "structure_corporation_group_defaults" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "structure_group_alert_configs_group_idx" ON "structure_group_alert_configs" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "structure_group_alert_configs_alert_type_idx" ON "structure_group_alert_configs" USING btree ("alert_type");--> statement-breakpoint
CREATE INDEX "structure_group_alert_configs_enabled_idx" ON "structure_group_alert_configs" USING btree ("is_enabled");--> statement-breakpoint
CREATE INDEX "structure_group_alert_configs_group_alert_type_idx" ON "structure_group_alert_configs" USING btree ("group_id","alert_type");--> statement-breakpoint
CREATE INDEX "structure_group_settings_group_id_idx" ON "structure_group_settings" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "structure_state_events_structure_id_idx" ON "structure_state_events" USING btree ("structure_id");--> statement-breakpoint
CREATE INDEX "structure_state_events_owner_id_idx" ON "structure_state_events" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "structure_state_events_detected_at_idx" ON "structure_state_events" USING btree ("detected_at");