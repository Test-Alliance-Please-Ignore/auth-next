CREATE TABLE "universe_eve_npc_stations" (
	"station_id" text PRIMARY KEY NOT NULL,
	"station_name" text NOT NULL,
	"solar_system_id" text NOT NULL,
	"orbit_id" text,
	"owner_id" text,
	"operation_id" text,
	"type_id" text,
	"use_operation_name" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "universe_eve_planets" (
	"planet_id" text PRIMARY KEY NOT NULL,
	"planet_name" text NOT NULL,
	"solar_system_id" text NOT NULL,
	"celestial_index" integer NOT NULL,
	"type_id" text
);
--> statement-breakpoint
CREATE TABLE "universe_eve_regions" (
	"region_id" text PRIMARY KEY NOT NULL,
	"region_name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "universe_eve_solar_systems" (
	"solar_system_id" text PRIMARY KEY NOT NULL,
	"solar_system_name" text NOT NULL,
	"region_id" text NOT NULL,
	"constellation_id" text NOT NULL,
	"security_status" text
);
--> statement-breakpoint
CREATE TABLE "universe_eve_stargates" (
	"stargate_id" text PRIMARY KEY NOT NULL,
	"stargate_name" text NOT NULL,
	"solar_system_id" text NOT NULL,
	"destination_solar_system_id" text,
	"destination_stargate_id" text,
	"type_id" text
);
--> statement-breakpoint
CREATE TABLE "universe_eve_market_groups" (
	"market_group_id" text PRIMARY KEY NOT NULL,
	"parent_group_id" text,
	"market_group_name" text NOT NULL,
	"description" text,
	"icon_id" text,
	"has_types" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX "universe_eve_npc_stations_station_id_idx" ON "universe_eve_npc_stations" USING btree ("station_id");--> statement-breakpoint
CREATE INDEX "universe_eve_npc_stations_station_name_idx" ON "universe_eve_npc_stations" USING btree ("station_name");--> statement-breakpoint
CREATE INDEX "universe_eve_npc_stations_solar_system_id_idx" ON "universe_eve_npc_stations" USING btree ("solar_system_id");--> statement-breakpoint
CREATE INDEX "universe_eve_planets_planet_id_idx" ON "universe_eve_planets" USING btree ("planet_id");--> statement-breakpoint
CREATE INDEX "universe_eve_planets_planet_name_idx" ON "universe_eve_planets" USING btree ("planet_name");--> statement-breakpoint
CREATE INDEX "universe_eve_planets_solar_system_id_idx" ON "universe_eve_planets" USING btree ("solar_system_id");--> statement-breakpoint
CREATE INDEX "universe_eve_regions_region_id_idx" ON "universe_eve_regions" USING btree ("region_id");--> statement-breakpoint
CREATE INDEX "universe_eve_regions_region_name_idx" ON "universe_eve_regions" USING btree ("region_name");--> statement-breakpoint
CREATE INDEX "universe_eve_solar_systems_solar_system_id_idx" ON "universe_eve_solar_systems" USING btree ("solar_system_id");--> statement-breakpoint
CREATE INDEX "universe_eve_solar_systems_solar_system_name_idx" ON "universe_eve_solar_systems" USING btree ("solar_system_name");--> statement-breakpoint
CREATE INDEX "universe_eve_solar_systems_region_id_idx" ON "universe_eve_solar_systems" USING btree ("region_id");--> statement-breakpoint
CREATE INDEX "universe_eve_solar_systems_constellation_id_idx" ON "universe_eve_solar_systems" USING btree ("constellation_id");--> statement-breakpoint
CREATE INDEX "universe_eve_stargates_stargate_id_idx" ON "universe_eve_stargates" USING btree ("stargate_id");--> statement-breakpoint
CREATE INDEX "universe_eve_stargates_stargate_name_idx" ON "universe_eve_stargates" USING btree ("stargate_name");--> statement-breakpoint
CREATE INDEX "universe_eve_stargates_solar_system_id_idx" ON "universe_eve_stargates" USING btree ("solar_system_id");--> statement-breakpoint
CREATE INDEX "universe_eve_stargates_destination_solar_system_id_idx" ON "universe_eve_stargates" USING btree ("destination_solar_system_id");--> statement-breakpoint
CREATE INDEX "universe_eve_market_groups_market_group_id_idx" ON "universe_eve_market_groups" USING btree ("market_group_id");--> statement-breakpoint
CREATE INDEX "universe_eve_market_groups_parent_group_id_idx" ON "universe_eve_market_groups" USING btree ("parent_group_id");--> statement-breakpoint
CREATE INDEX "universe_eve_market_groups_market_group_name_idx" ON "universe_eve_market_groups" USING btree ("market_group_name");--> statement-breakpoint
CREATE INDEX "universe_eve_market_groups_has_types_idx" ON "universe_eve_market_groups" USING btree ("has_types");