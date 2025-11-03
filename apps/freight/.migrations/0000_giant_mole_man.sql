CREATE TYPE "public"."freight_route_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TABLE "freight_routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pickup_system_id" text NOT NULL,
	"pickup_region_id" text NOT NULL,
	"pickup_structure_id" text NOT NULL,
	"pickup_constellation_id" text,
	"destination_system_id" text NOT NULL,
	"destination_region_id" text NOT NULL,
	"destination_structure_id" text NOT NULL,
	"destination_constellation_id" text,
	"isk_per_volume_unit" text NOT NULL,
	"max_volume" text,
	"notes" text,
	"status" "freight_route_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "freight_routes_status_idx" ON "freight_routes" USING btree ("status");--> statement-breakpoint
CREATE INDEX "freight_routes_pickup_system_id_idx" ON "freight_routes" USING btree ("pickup_system_id");--> statement-breakpoint
CREATE INDEX "freight_routes_destination_system_id_idx" ON "freight_routes" USING btree ("destination_system_id");--> statement-breakpoint
CREATE INDEX "freight_routes_created_at_idx" ON "freight_routes" USING btree ("created_at");