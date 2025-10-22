-- Drop all foreign key constraints
ALTER TABLE "character_portraits" DROP CONSTRAINT IF EXISTS "character_portraits_character_id_character_public_info_character_id_fk";--> statement-breakpoint
ALTER TABLE "character_corporation_history" DROP CONSTRAINT IF EXISTS "character_corporation_history_character_id_character_public_info_character_id_fk";--> statement-breakpoint
ALTER TABLE "character_skills" DROP CONSTRAINT IF EXISTS "character_skills_character_id_character_public_info_character_id_fk";--> statement-breakpoint
ALTER TABLE "character_attributes" DROP CONSTRAINT IF EXISTS "character_attributes_character_id_character_public_info_character_id_fk";--> statement-breakpoint
ALTER TABLE "character_location" DROP CONSTRAINT IF EXISTS "character_location_character_id_character_public_info_character_id_fk";--> statement-breakpoint
ALTER TABLE "character_wallet" DROP CONSTRAINT IF EXISTS "character_wallet_character_id_character_public_info_character_id_fk";--> statement-breakpoint
ALTER TABLE "character_assets" DROP CONSTRAINT IF EXISTS "character_assets_character_id_character_public_info_character_id_fk";--> statement-breakpoint
ALTER TABLE "character_status" DROP CONSTRAINT IF EXISTS "character_status_character_id_character_public_info_character_id_fk";--> statement-breakpoint
ALTER TABLE "character_skill_queue" DROP CONSTRAINT IF EXISTS "character_skill_queue_character_id_character_public_info_character_id_fk";--> statement-breakpoint
ALTER TABLE "character_wallet_journal" DROP CONSTRAINT IF EXISTS "character_wallet_journal_character_id_character_public_info_character_id_fk";--> statement-breakpoint
ALTER TABLE "character_market_transactions" DROP CONSTRAINT IF EXISTS "character_market_transactions_character_id_character_public_info_character_id_fk";--> statement-breakpoint
ALTER TABLE "character_market_orders" DROP CONSTRAINT IF EXISTS "character_market_orders_character_id_character_public_info_character_id_fk";--> statement-breakpoint

-- Alter all columns to text
ALTER TABLE "character_public_info" ALTER COLUMN "character_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "character_public_info" ALTER COLUMN "corporation_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "character_public_info" ALTER COLUMN "alliance_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "character_public_info" ALTER COLUMN "race_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "character_public_info" ALTER COLUMN "bloodline_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "character_public_info" ALTER COLUMN "faction_id" SET DATA TYPE text;--> statement-breakpoint

ALTER TABLE "character_portraits" ALTER COLUMN "character_id" SET DATA TYPE text;--> statement-breakpoint

ALTER TABLE "character_corporation_history" ALTER COLUMN "character_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "character_corporation_history" ALTER COLUMN "record_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "character_corporation_history" ALTER COLUMN "corporation_id" SET DATA TYPE text;--> statement-breakpoint

ALTER TABLE "character_skills" ALTER COLUMN "character_id" SET DATA TYPE text;--> statement-breakpoint

ALTER TABLE "character_attributes" ALTER COLUMN "character_id" SET DATA TYPE text;--> statement-breakpoint

ALTER TABLE "character_location" ALTER COLUMN "character_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "character_location" ALTER COLUMN "solar_system_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "character_location" ALTER COLUMN "station_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "character_location" ALTER COLUMN "structure_id" SET DATA TYPE text;--> statement-breakpoint

ALTER TABLE "character_wallet" ALTER COLUMN "character_id" SET DATA TYPE text;--> statement-breakpoint

ALTER TABLE "character_assets" ALTER COLUMN "character_id" SET DATA TYPE text;--> statement-breakpoint

ALTER TABLE "character_status" ALTER COLUMN "character_id" SET DATA TYPE text;--> statement-breakpoint

ALTER TABLE "character_skill_queue" ALTER COLUMN "character_id" SET DATA TYPE text;--> statement-breakpoint

ALTER TABLE "character_wallet_journal" ALTER COLUMN "character_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "character_wallet_journal" ALTER COLUMN "journal_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "character_wallet_journal" ALTER COLUMN "first_party_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "character_wallet_journal" ALTER COLUMN "second_party_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "character_wallet_journal" ALTER COLUMN "tax_receiver_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "character_wallet_journal" ALTER COLUMN "context_id" SET DATA TYPE text;--> statement-breakpoint

ALTER TABLE "character_market_transactions" ALTER COLUMN "character_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "character_market_transactions" ALTER COLUMN "transaction_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "character_market_transactions" ALTER COLUMN "type_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "character_market_transactions" ALTER COLUMN "client_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "character_market_transactions" ALTER COLUMN "location_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "character_market_transactions" ALTER COLUMN "journal_ref_id" SET DATA TYPE text;--> statement-breakpoint

ALTER TABLE "character_market_orders" ALTER COLUMN "character_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "character_market_orders" ALTER COLUMN "order_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "character_market_orders" ALTER COLUMN "type_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "character_market_orders" ALTER COLUMN "location_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "character_market_orders" ALTER COLUMN "region_id" SET DATA TYPE text;--> statement-breakpoint

-- Recreate foreign key constraints
ALTER TABLE "character_portraits" ADD CONSTRAINT "character_portraits_character_id_character_public_info_character_id_fk" FOREIGN KEY ("character_id") REFERENCES "character_public_info"("character_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_corporation_history" ADD CONSTRAINT "character_corporation_history_character_id_character_public_info_character_id_fk" FOREIGN KEY ("character_id") REFERENCES "character_public_info"("character_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_skills" ADD CONSTRAINT "character_skills_character_id_character_public_info_character_id_fk" FOREIGN KEY ("character_id") REFERENCES "character_public_info"("character_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_attributes" ADD CONSTRAINT "character_attributes_character_id_character_public_info_character_id_fk" FOREIGN KEY ("character_id") REFERENCES "character_public_info"("character_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_location" ADD CONSTRAINT "character_location_character_id_character_public_info_character_id_fk" FOREIGN KEY ("character_id") REFERENCES "character_public_info"("character_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_wallet" ADD CONSTRAINT "character_wallet_character_id_character_public_info_character_id_fk" FOREIGN KEY ("character_id") REFERENCES "character_public_info"("character_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_assets" ADD CONSTRAINT "character_assets_character_id_character_public_info_character_id_fk" FOREIGN KEY ("character_id") REFERENCES "character_public_info"("character_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_status" ADD CONSTRAINT "character_status_character_id_character_public_info_character_id_fk" FOREIGN KEY ("character_id") REFERENCES "character_public_info"("character_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_skill_queue" ADD CONSTRAINT "character_skill_queue_character_id_character_public_info_character_id_fk" FOREIGN KEY ("character_id") REFERENCES "character_public_info"("character_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_wallet_journal" ADD CONSTRAINT "character_wallet_journal_character_id_character_public_info_character_id_fk" FOREIGN KEY ("character_id") REFERENCES "character_public_info"("character_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_market_transactions" ADD CONSTRAINT "character_market_transactions_character_id_character_public_info_character_id_fk" FOREIGN KEY ("character_id") REFERENCES "character_public_info"("character_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_market_orders" ADD CONSTRAINT "character_market_orders_character_id_character_public_info_character_id_fk" FOREIGN KEY ("character_id") REFERENCES "character_public_info"("character_id") ON DELETE no action ON UPDATE no action;
