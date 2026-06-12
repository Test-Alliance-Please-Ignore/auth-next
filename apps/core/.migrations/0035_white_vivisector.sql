CREATE TABLE "alert_destinations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" text NOT NULL,
	"alert_type" text NOT NULL,
	"destination_type" text NOT NULL,
	"discord_server_id" uuid,
	"channel_id" text,
	"core_user_id" uuid,
	"group_id" text,
	"destination_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "corporation_alert_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"corporation_id" text NOT NULL,
	"alert_type" text NOT NULL,
	"destination_ids" uuid[] DEFAULT '{}' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "corporation_alert_configs_corp_alert_type_unique" UNIQUE("corporation_id","alert_type")
);
--> statement-breakpoint
ALTER TABLE "alert_destinations" ADD CONSTRAINT "alert_destinations_discord_server_id_discord_servers_id_fk" FOREIGN KEY ("discord_server_id") REFERENCES "public"."discord_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_destinations" ADD CONSTRAINT "alert_destinations_core_user_id_users_id_fk" FOREIGN KEY ("core_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_destinations" ADD CONSTRAINT "alert_destinations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_destinations" ADD CONSTRAINT "alert_destinations_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporation_alert_configs" ADD CONSTRAINT "corporation_alert_configs_corporation_id_managed_corporations_corporation_id_fk" FOREIGN KEY ("corporation_id") REFERENCES "public"."managed_corporations"("corporation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alert_destinations_scope_idx" ON "alert_destinations" USING btree ("scope_type","scope_id");--> statement-breakpoint
CREATE INDEX "alert_destinations_alert_type_idx" ON "alert_destinations" USING btree ("alert_type");--> statement-breakpoint
CREATE INDEX "alert_destinations_type_idx" ON "alert_destinations" USING btree ("destination_type");--> statement-breakpoint
CREATE INDEX "alert_destinations_enabled_idx" ON "alert_destinations" USING btree ("is_enabled");--> statement-breakpoint
CREATE INDEX "corporation_alert_configs_corp_idx" ON "corporation_alert_configs" USING btree ("corporation_id");--> statement-breakpoint
CREATE INDEX "corporation_alert_configs_alert_type_idx" ON "corporation_alert_configs" USING btree ("alert_type");--> statement-breakpoint
CREATE INDEX "corporation_alert_configs_enabled_idx" ON "corporation_alert_configs" USING btree ("is_enabled");--> statement-breakpoint
CREATE INDEX "corporation_alert_configs_corp_alert_type_idx" ON "corporation_alert_configs" USING btree ("corporation_id","alert_type");