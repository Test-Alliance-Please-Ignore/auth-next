CREATE TABLE "fleet_member_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fleet_id" text NOT NULL,
	"character_id" text NOT NULL,
	"event_type" text NOT NULL,
	"ship_type_id" integer NOT NULL,
	"solar_system_id" integer NOT NULL,
	"station_id" integer,
	"role" text NOT NULL,
	"role_name" text NOT NULL,
	"squad_id" integer NOT NULL,
	"wing_id" integer NOT NULL,
	"joined_at" timestamp,
	"left_at" timestamp,
	"event_timestamp" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "fleet_member_history_fleet_id_idx" ON "fleet_member_history" USING btree ("fleet_id");--> statement-breakpoint
CREATE INDEX "fleet_member_history_character_id_idx" ON "fleet_member_history" USING btree ("character_id");--> statement-breakpoint
CREATE INDEX "fleet_member_history_event_type_idx" ON "fleet_member_history" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "fleet_member_history_event_timestamp_idx" ON "fleet_member_history" USING btree ("event_timestamp");--> statement-breakpoint
CREATE INDEX "fleet_member_history_fleet_character_idx" ON "fleet_member_history" USING btree ("fleet_id","character_id");