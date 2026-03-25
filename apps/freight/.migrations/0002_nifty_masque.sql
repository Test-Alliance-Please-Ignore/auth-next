ALTER TABLE "freight_routes" ALTER COLUMN "pickup_system_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "freight_routes" ALTER COLUMN "pickup_region_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "freight_routes" ALTER COLUMN "pickup_structure_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "freight_routes" ALTER COLUMN "destination_system_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "freight_routes" ALTER COLUMN "destination_region_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "freight_routes" ALTER COLUMN "destination_structure_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "freight_routes" ADD COLUMN "pickup_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "freight_routes" ADD COLUMN "destination_name" text DEFAULT '' NOT NULL;