ALTER TABLE "latest_market_prices" ALTER COLUMN "best_buy_volume" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "latest_market_prices" ALTER COLUMN "total_buy_volume" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "latest_market_prices" ALTER COLUMN "total_buy_volume" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "latest_market_prices" ALTER COLUMN "best_sell_volume" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "latest_market_prices" ALTER COLUMN "total_sell_volume" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "latest_market_prices" ALTER COLUMN "total_sell_volume" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "market_orders" ALTER COLUMN "volume_remain" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "market_orders" ALTER COLUMN "volume_total" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "market_orders" ALTER COLUMN "min_volume" SET DATA TYPE text;