ALTER TABLE "corporation_assets" ALTER COLUMN "is_singleton" SET DEFAULT false;--> statement-breakpoint
ALTER TABLE "corporation_contracts" ALTER COLUMN "for_corporation" SET DEFAULT false;--> statement-breakpoint
ALTER TABLE "corporation_orders" ALTER COLUMN "is_buy_order" SET DEFAULT false;--> statement-breakpoint
ALTER TABLE "corporation_wallet_transactions" ALTER COLUMN "is_buy" SET DEFAULT false;--> statement-breakpoint
ALTER TABLE "corporation_wallet_transactions" ALTER COLUMN "is_personal" SET DEFAULT false;