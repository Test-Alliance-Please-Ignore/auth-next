CREATE TABLE "fleet_member_ship_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracking_session_id" uuid NOT NULL,
	"fleet_id" text NOT NULL,
	"character_id" text NOT NULL,
	"ship_type_id" integer NOT NULL,
	"solar_system_id" integer NOT NULL,
	"station_id" integer,
	"started_at" timestamp NOT NULL,
	"ended_at" timestamp,
	"event_timestamp" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fleet_tracking_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"character_id" text NOT NULL,
	"started_by_user_id" text NOT NULL,
	"fleet_id" text,
	"status" text DEFAULT 'active' NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"ended_at" timestamp,
	"ended_reason" text,
	"ended_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "monitored_fleet_commanders" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "monitored_fleet_commanders" CASCADE;--> statement-breakpoint
ALTER TABLE "fleet_member_history" ADD COLUMN "corporation_id" text;--> statement-breakpoint
ALTER TABLE "fleet_state_cache" ADD COLUMN "tracking_session_id" uuid;--> statement-breakpoint
ALTER TABLE "fleet_summaries" ADD COLUMN "tracking_session_id" uuid;--> statement-breakpoint
ALTER TABLE "fleet_member_ship_events" ADD CONSTRAINT "fleet_member_ship_events_tracking_session_id_fleet_tracking_sessions_id_fk" FOREIGN KEY ("tracking_session_id") REFERENCES "public"."fleet_tracking_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fleet_member_ship_events_session_character_started_idx" ON "fleet_member_ship_events" USING btree ("tracking_session_id","character_id","started_at");--> statement-breakpoint
CREATE INDEX "fleet_member_ship_events_fleet_character_started_idx" ON "fleet_member_ship_events" USING btree ("fleet_id","character_id","started_at");--> statement-breakpoint
CREATE INDEX "fleet_member_ship_events_event_timestamp_idx" ON "fleet_member_ship_events" USING btree ("event_timestamp");--> statement-breakpoint
CREATE INDEX "fleet_member_ship_events_ended_at_idx" ON "fleet_member_ship_events" USING btree ("ended_at");--> statement-breakpoint
CREATE INDEX "fleet_tracking_sessions_character_id_idx" ON "fleet_tracking_sessions" USING btree ("character_id");--> statement-breakpoint
CREATE INDEX "fleet_tracking_sessions_fleet_id_idx" ON "fleet_tracking_sessions" USING btree ("fleet_id");--> statement-breakpoint
CREATE INDEX "fleet_tracking_sessions_started_by_user_id_idx" ON "fleet_tracking_sessions" USING btree ("started_by_user_id");--> statement-breakpoint
CREATE INDEX "fleet_tracking_sessions_status_idx" ON "fleet_tracking_sessions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "fleet_tracking_sessions_started_at_idx" ON "fleet_tracking_sessions" USING btree ("started_at");--> statement-breakpoint
ALTER TABLE "fleet_state_cache" ADD CONSTRAINT "fleet_state_cache_tracking_session_id_fleet_tracking_sessions_id_fk" FOREIGN KEY ("tracking_session_id") REFERENCES "public"."fleet_tracking_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_summaries" ADD CONSTRAINT "fleet_summaries_tracking_session_id_fleet_tracking_sessions_id_fk" FOREIGN KEY ("tracking_session_id") REFERENCES "public"."fleet_tracking_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fleet_member_history_corporation_id_idx" ON "fleet_member_history" USING btree ("corporation_id");--> statement-breakpoint
CREATE INDEX "fleet_state_cache_tracking_session_id_idx" ON "fleet_state_cache" USING btree ("tracking_session_id");--> statement-breakpoint
CREATE INDEX "fleet_summaries_tracking_session_id_idx" ON "fleet_summaries" USING btree ("tracking_session_id");