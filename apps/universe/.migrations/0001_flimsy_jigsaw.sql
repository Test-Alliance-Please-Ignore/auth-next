CREATE TABLE "universe_killmails" (
	"killmail_id" text NOT NULL,
	"killmail_hash" text NOT NULL,
	"killmail_time" timestamp with time zone NOT NULL,
	"solar_system_id" text NOT NULL,
	"solar_system_name" text,
	"moon_id" text,
	"moon_name" text,
	"war_id" text,
	"war_name" text,
	"victim_character_id" text,
	"victim_character_name" text,
	"victim_corporation_id" text,
	"victim_corporation_name" text,
	"victim_alliance_id" text,
	"victim_alliance_name" text,
	"victim_ship_type_id" text NOT NULL,
	"victim_ship_type_name" text,
	"victim_damage_taken" integer NOT NULL,
	"attacker_character_ids" jsonb,
	"attacker_character_names" jsonb,
	"attacker_corporation_ids" jsonb,
	"attacker_corporation_names" jsonb,
	"killmail_data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "universe_killmails_killmail_id_killmail_hash_unique" UNIQUE("killmail_id","killmail_hash")
);
--> statement-breakpoint
CREATE INDEX "universe_killmails_killmail_id_idx" ON "universe_killmails" USING btree ("killmail_id");--> statement-breakpoint
CREATE INDEX "universe_killmails_victim_character_time_idx" ON "universe_killmails" USING btree ("victim_character_id","killmail_time");--> statement-breakpoint
CREATE INDEX "universe_killmails_victim_corporation_time_idx" ON "universe_killmails" USING btree ("victim_corporation_id","killmail_time");--> statement-breakpoint
CREATE INDEX "universe_killmails_attacker_character_gin_idx" ON "universe_killmails" USING gin ("attacker_character_ids");--> statement-breakpoint
CREATE INDEX "universe_killmails_attacker_corporation_gin_idx" ON "universe_killmails" USING gin ("attacker_corporation_ids");--> statement-breakpoint
CREATE INDEX "universe_killmails_solar_system_time_idx" ON "universe_killmails" USING btree ("solar_system_id","killmail_time");--> statement-breakpoint
CREATE INDEX "universe_killmails_killmail_time_idx" ON "universe_killmails" USING btree ("killmail_time");