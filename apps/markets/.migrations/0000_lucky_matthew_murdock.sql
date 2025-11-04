CREATE TABLE "latest_market_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"region_id" text NOT NULL,
	"type_id" text NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"snapshot_time" timestamp with time zone NOT NULL,
	"best_buy_price" text,
	"best_buy_order_id" text,
	"best_buy_location" text,
	"best_buy_volume" integer,
	"total_buy_volume" integer DEFAULT 0 NOT NULL,
	"buy_order_count" integer DEFAULT 0 NOT NULL,
	"best_sell_price" text,
	"best_sell_order_id" text,
	"best_sell_location" text,
	"best_sell_volume" integer,
	"total_sell_volume" integer DEFAULT 0 NOT NULL,
	"sell_order_count" integer DEFAULT 0 NOT NULL,
	"spread_amount" text,
	"spread_percent" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "latest_prices_region_type_unique" UNIQUE("region_id","type_id")
);
--> statement-breakpoint
CREATE TABLE "market_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"region_id" text NOT NULL,
	"snapshot_time" timestamp with time zone NOT NULL,
	"order_id" text NOT NULL,
	"type_id" text NOT NULL,
	"location_id" text NOT NULL,
	"system_id" text NOT NULL,
	"price" text NOT NULL,
	"volume_remain" integer NOT NULL,
	"volume_total" integer NOT NULL,
	"min_volume" integer NOT NULL,
	"is_buy_order" boolean NOT NULL,
	"duration" integer NOT NULL,
	"issued" timestamp with time zone NOT NULL,
	"range" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"region_id" text NOT NULL,
	"snapshot_time" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"order_count" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"fetch_duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "market_orders" ADD CONSTRAINT "market_orders_snapshot_id_market_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."market_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "latest_prices_region_idx" ON "latest_market_prices" USING btree ("region_id");--> statement-breakpoint
CREATE INDEX "latest_prices_region_type_idx" ON "latest_market_prices" USING btree ("region_id","type_id");--> statement-breakpoint
CREATE INDEX "market_orders_region_type_time_idx" ON "market_orders" USING btree ("region_id","type_id","snapshot_time" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "market_orders_region_type_buy_time_idx" ON "market_orders" USING btree ("region_id","type_id","is_buy_order","snapshot_time" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "market_orders_snapshot_idx" ON "market_orders" USING btree ("snapshot_id");--> statement-breakpoint
CREATE INDEX "market_orders_location_type_time_idx" ON "market_orders" USING btree ("location_id","type_id","snapshot_time" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "market_orders_order_snapshot_idx" ON "market_orders" USING btree ("order_id","snapshot_id");--> statement-breakpoint
CREATE INDEX "market_snapshots_region_time_idx" ON "market_snapshots" USING btree ("region_id","snapshot_time" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "market_snapshots_region_status_time_idx" ON "market_snapshots" USING btree ("region_id","status","snapshot_time" DESC NULLS LAST);