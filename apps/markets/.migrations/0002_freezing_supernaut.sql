ALTER TABLE "latest_market_prices" RENAME COLUMN "region_id" TO "location_id";--> statement-breakpoint
ALTER TABLE "market_orders" RENAME COLUMN "region_id" TO "source_location_id";--> statement-breakpoint
ALTER TABLE "market_snapshots" RENAME COLUMN "region_id" TO "location_id";--> statement-breakpoint
ALTER TABLE "latest_market_prices" DROP CONSTRAINT "latest_prices_region_type_unique";--> statement-breakpoint
DROP INDEX "latest_prices_region_idx";--> statement-breakpoint
DROP INDEX "latest_prices_region_type_idx";--> statement-breakpoint
DROP INDEX "market_orders_region_type_time_idx";--> statement-breakpoint
DROP INDEX "market_orders_region_type_buy_time_idx";--> statement-breakpoint
DROP INDEX "market_snapshots_region_time_idx";--> statement-breakpoint
DROP INDEX "market_snapshots_region_status_time_idx";--> statement-breakpoint
-- Add location_type columns as nullable first
ALTER TABLE "latest_market_prices" ADD COLUMN "location_type" text;--> statement-breakpoint
ALTER TABLE "market_orders" ADD COLUMN "source_location_type" text;--> statement-breakpoint
ALTER TABLE "market_snapshots" ADD COLUMN "location_type" text;--> statement-breakpoint
-- Backfill all existing rows with 'region' (this was a regions-only system before)
UPDATE "latest_market_prices" SET "location_type" = 'region' WHERE "location_type" IS NULL;--> statement-breakpoint
UPDATE "market_orders" SET "source_location_type" = 'region' WHERE "source_location_type" IS NULL;--> statement-breakpoint
UPDATE "market_snapshots" SET "location_type" = 'region' WHERE "location_type" IS NULL;--> statement-breakpoint
-- Now make them NOT NULL
ALTER TABLE "latest_market_prices" ALTER COLUMN "location_type" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "market_orders" ALTER COLUMN "source_location_type" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "market_snapshots" ALTER COLUMN "location_type" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "latest_prices_location_idx" ON "latest_market_prices" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "latest_prices_location_type_idx" ON "latest_market_prices" USING btree ("location_id","type_id");--> statement-breakpoint
CREATE INDEX "market_orders_source_type_time_idx" ON "market_orders" USING btree ("source_location_id","type_id","snapshot_time" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "market_orders_source_type_buy_time_idx" ON "market_orders" USING btree ("source_location_id","type_id","is_buy_order","snapshot_time" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "market_snapshots_location_time_idx" ON "market_snapshots" USING btree ("location_id","snapshot_time" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "market_snapshots_location_status_time_idx" ON "market_snapshots" USING btree ("location_id","status","snapshot_time" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "latest_market_prices" ADD CONSTRAINT "latest_prices_location_type_unique" UNIQUE("location_id","type_id");