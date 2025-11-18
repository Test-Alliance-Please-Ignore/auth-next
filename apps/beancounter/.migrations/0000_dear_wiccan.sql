CREATE TYPE "public"."structure_monitor_status" AS ENUM('idle', 'starting', 'active', 'degraded', 'unresponsive', 'disabled');--> statement-breakpoint
CREATE TABLE "beancounter_structure_monitor_corporations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"corporation_id" text NOT NULL,
	"name" text,
	"ticker" text,
	"tracking_enabled" boolean DEFAULT true NOT NULL,
	"structure_type_filter" jsonb DEFAULT 'null'::jsonb,
	"minimum_fuel_hours" integer DEFAULT 48 NOT NULL,
	"last_scan_started_at" timestamp with time zone,
	"last_scan_completed_at" timestamp with time zone,
	"last_scan_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "beancounter_structure_monitor_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"structure_id" uuid NOT NULL,
	"durable_object_name" text NOT NULL,
	"status" "structure_monitor_status" DEFAULT 'idle' NOT NULL,
	"last_heartbeat_at" timestamp with time zone,
	"last_health_check_at" timestamp with time zone,
	"last_error" text,
	"next_alarm_at" timestamp with time zone,
	"health_metadata" jsonb DEFAULT 'null'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "beancounter_structure_monitor_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"structure_id" uuid NOT NULL,
	"monitor_instance_id" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"status" text DEFAULT 'pending' NOT NULL,
	"result_summary" text,
	"fuel_status" jsonb DEFAULT 'null'::jsonb,
	"inventory_status" jsonb DEFAULT 'null'::jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "beancounter_structure_monitor_structures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"corporation_id" uuid NOT NULL,
	"structure_id" text NOT NULL,
	"name" text,
	"type_id" text,
	"solar_system_id" text,
	"profile_id" text,
	"fuel_expires_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"last_inventory_hash" text,
	"monitoring_enabled" boolean DEFAULT true NOT NULL,
	"tags" jsonb DEFAULT 'null'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "beancounter_structure_monitor_instances" ADD CONSTRAINT "beancounter_structure_monitor_instances_structure_id_beancounter_structure_monitor_structures_id_fk" FOREIGN KEY ("structure_id") REFERENCES "public"."beancounter_structure_monitor_structures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beancounter_structure_monitor_runs" ADD CONSTRAINT "beancounter_structure_monitor_runs_structure_id_beancounter_structure_monitor_structures_id_fk" FOREIGN KEY ("structure_id") REFERENCES "public"."beancounter_structure_monitor_structures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beancounter_structure_monitor_runs" ADD CONSTRAINT "beancounter_structure_monitor_runs_monitor_instance_id_beancounter_structure_monitor_instances_id_fk" FOREIGN KEY ("monitor_instance_id") REFERENCES "public"."beancounter_structure_monitor_instances"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beancounter_structure_monitor_structures" ADD CONSTRAINT "beancounter_structure_monitor_structures_corporation_id_beancounter_structure_monitor_corporations_id_fk" FOREIGN KEY ("corporation_id") REFERENCES "public"."beancounter_structure_monitor_corporations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "beancounter_structure_monitor_corporations_corporation_id_idx" ON "beancounter_structure_monitor_corporations" USING btree ("corporation_id");--> statement-breakpoint
CREATE INDEX "beancounter_structure_monitor_corporations_tracking_idx" ON "beancounter_structure_monitor_corporations" USING btree ("tracking_enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "beancounter_structure_monitor_instances_structure_idx" ON "beancounter_structure_monitor_instances" USING btree ("structure_id");--> statement-breakpoint
CREATE INDEX "beancounter_structure_monitor_instances_status_idx" ON "beancounter_structure_monitor_instances" USING btree ("status","last_heartbeat_at");--> statement-breakpoint
CREATE INDEX "beancounter_structure_monitor_runs_structure_idx" ON "beancounter_structure_monitor_runs" USING btree ("structure_id");--> statement-breakpoint
CREATE INDEX "beancounter_structure_monitor_runs_status_idx" ON "beancounter_structure_monitor_runs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "beancounter_structure_monitor_structures_structure_id_idx" ON "beancounter_structure_monitor_structures" USING btree ("structure_id");--> statement-breakpoint
CREATE INDEX "beancounter_structure_monitor_structures_corporation_idx" ON "beancounter_structure_monitor_structures" USING btree ("corporation_id");