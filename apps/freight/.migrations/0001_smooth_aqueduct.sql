ALTER TABLE "freight_routes" ADD COLUMN "collateral_fee_rate" text;--> statement-breakpoint
ALTER TABLE "freight_routes" ADD COLUMN "expiration" integer;--> statement-breakpoint
ALTER TABLE "freight_routes" ADD COLUMN "days_to_complete" integer;
