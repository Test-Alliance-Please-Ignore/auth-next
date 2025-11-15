CREATE TABLE "fleet_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fleet_id" text NOT NULL,
	"fleet_boss_id" text NOT NULL,
	"started_at" timestamp NOT NULL,
	"ended_at" timestamp NOT NULL,
	"peak_member_count" integer DEFAULT 0 NOT NULL,
	"final_member_count" integer DEFAULT 0 NOT NULL,
	"motd" text,
	"is_free_move" boolean DEFAULT false NOT NULL,
	"is_registered" boolean DEFAULT false NOT NULL,
	"is_voice_enabled" boolean DEFAULT false NOT NULL,
	"duration_minutes" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "fleet_summaries_fleet_id_idx" ON "fleet_summaries" USING btree ("fleet_id");--> statement-breakpoint
CREATE INDEX "fleet_summaries_fleet_boss_id_idx" ON "fleet_summaries" USING btree ("fleet_boss_id");--> statement-breakpoint
CREATE INDEX "fleet_summaries_started_at_idx" ON "fleet_summaries" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "fleet_summaries_ended_at_idx" ON "fleet_summaries" USING btree ("ended_at");--> statement-breakpoint
CREATE INDEX "fleet_summaries_fleet_boss_started_idx" ON "fleet_summaries" USING btree ("fleet_boss_id","started_at");