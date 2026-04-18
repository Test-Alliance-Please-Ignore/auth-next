CREATE TABLE "insurance_daily_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type_id" text NOT NULL,
	"price_date" text NOT NULL,
	"platinum_cost" text,
	"platinum_payout" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_daily_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" text NOT NULL,
	"location_type" text NOT NULL,
	"price_date" date NOT NULL,
	"type_id" text NOT NULL,
	"avg_sell_price" text,
	"avg_buy_price" text,
	"min_sell_price" text,
	"max_sell_price" text,
	"snapshot_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_prices_location_type_date_unique" UNIQUE("location_id","type_id","price_date")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "insurance_daily_prices_type_date_idx" ON "insurance_daily_prices" USING btree ("type_id","price_date");--> statement-breakpoint
CREATE INDEX "daily_prices_location_type_date_idx" ON "market_daily_prices" USING btree ("location_id","type_id","price_date");--> statement-breakpoint
CREATE INDEX "daily_prices_location_date_idx" ON "market_daily_prices" USING btree ("location_id","price_date");