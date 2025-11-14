CREATE TABLE "monitored_fleet_commanders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"character_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "monitored_fleet_commanders_character_id_unique" UNIQUE("character_id")
);
--> statement-breakpoint
CREATE INDEX "monitored_fleet_commanders_character_id_idx" ON "monitored_fleet_commanders" USING btree ("character_id");