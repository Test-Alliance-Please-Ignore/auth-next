CREATE TABLE "universe_eve_constellations" (
	"constellation_id" text PRIMARY KEY NOT NULL,
	"constellation_name" text NOT NULL,
	"region_id" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "universe_eve_constellations_constellation_id_idx" ON "universe_eve_constellations" USING btree ("constellation_id");--> statement-breakpoint
CREATE INDEX "universe_eve_constellations_region_id_idx" ON "universe_eve_constellations" USING btree ("region_id");