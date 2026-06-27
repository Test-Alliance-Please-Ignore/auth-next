CREATE TABLE "fleet_commander_access_anchors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fleet_id" text NOT NULL,
	"tracking_session_id" uuid,
	"commander_character_id" text NOT NULL,
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fleet_commander_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fleet_id" text NOT NULL,
	"tracking_session_id" uuid,
	"previous_commander_character_id" text,
	"commander_character_id" text NOT NULL,
	"event_type" text NOT NULL,
	"observed_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fleet_tracking_session_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fleet_id" text NOT NULL,
	"tracking_session_id" uuid,
	"previous_character_id" text,
	"character_id" text NOT NULL,
	"event_type" text NOT NULL,
	"observed_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fleet_commander_access_anchors" ADD CONSTRAINT "fleet_commander_access_anchors_tracking_session_id_fleet_tracking_sessions_id_fk" FOREIGN KEY ("tracking_session_id") REFERENCES "public"."fleet_tracking_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_commander_events" ADD CONSTRAINT "fleet_commander_events_tracking_session_id_fleet_tracking_sessions_id_fk" FOREIGN KEY ("tracking_session_id") REFERENCES "public"."fleet_tracking_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_tracking_session_events" ADD CONSTRAINT "fleet_tracking_session_events_tracking_session_id_fleet_tracking_sessions_id_fk" FOREIGN KEY ("tracking_session_id") REFERENCES "public"."fleet_tracking_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fleet_commander_access_anchors_fleet_id_idx" ON "fleet_commander_access_anchors" USING btree ("fleet_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fleet_commander_access_anchors_fleet_id_commander_character_id_unique" ON "fleet_commander_access_anchors" USING btree ("fleet_id","commander_character_id");--> statement-breakpoint
CREATE INDEX "fleet_commander_access_anchors_tracking_session_id_idx" ON "fleet_commander_access_anchors" USING btree ("tracking_session_id");--> statement-breakpoint
CREATE INDEX "fleet_commander_access_anchors_commander_character_id_idx" ON "fleet_commander_access_anchors" USING btree ("commander_character_id");--> statement-breakpoint
CREATE INDEX "fleet_commander_access_anchors_last_seen_at_idx" ON "fleet_commander_access_anchors" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX "fleet_commander_events_fleet_id_idx" ON "fleet_commander_events" USING btree ("fleet_id");--> statement-breakpoint
CREATE INDEX "fleet_commander_events_tracking_session_id_idx" ON "fleet_commander_events" USING btree ("tracking_session_id");--> statement-breakpoint
CREATE INDEX "fleet_commander_events_commander_character_id_idx" ON "fleet_commander_events" USING btree ("commander_character_id");--> statement-breakpoint
CREATE INDEX "fleet_commander_events_observed_at_idx" ON "fleet_commander_events" USING btree ("observed_at");--> statement-breakpoint
CREATE INDEX "fleet_tracking_session_events_fleet_id_idx" ON "fleet_tracking_session_events" USING btree ("fleet_id");--> statement-breakpoint
CREATE INDEX "fleet_tracking_session_events_tracking_session_id_idx" ON "fleet_tracking_session_events" USING btree ("tracking_session_id");--> statement-breakpoint
CREATE INDEX "fleet_tracking_session_events_character_id_idx" ON "fleet_tracking_session_events" USING btree ("character_id");--> statement-breakpoint
CREATE INDEX "fleet_tracking_session_events_observed_at_idx" ON "fleet_tracking_session_events" USING btree ("observed_at");