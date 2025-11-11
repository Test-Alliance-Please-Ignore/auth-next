CREATE TABLE "character_killmails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"character_id" text NOT NULL,
	"killmail_id" text NOT NULL,
	"killmail_hash" text NOT NULL,
	"killmail_time" timestamp with time zone NOT NULL,
	"is_loss" boolean,
	"ship_type_id" text,
	"total_value" text,
	"solar_system_id" text,
	"victim_character_id" text,
	"killmail_data" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "character_killmails_character_id_killmail_id_unique" UNIQUE("character_id","killmail_id")
);
--> statement-breakpoint
-- Step 1: Drop all foreign key constraints that reference character_id
ALTER TABLE "character_assets" DROP CONSTRAINT "character_assets_character_id_character_public_info_character_i";--> statement-breakpoint
ALTER TABLE "character_attributes" DROP CONSTRAINT "character_attributes_character_id_character_public_info_charact";--> statement-breakpoint
ALTER TABLE "character_corporation_history" DROP CONSTRAINT "character_corporation_history_character_id_character_public_inf";--> statement-breakpoint
ALTER TABLE "character_location" DROP CONSTRAINT "character_location_character_id_character_public_info_character";--> statement-breakpoint
ALTER TABLE "character_market_orders" DROP CONSTRAINT "character_market_orders_character_id_character_public_info_char";--> statement-breakpoint
ALTER TABLE "character_market_transactions" DROP CONSTRAINT "character_market_transactions_character_id_character_public_inf";--> statement-breakpoint
ALTER TABLE "character_portraits" DROP CONSTRAINT "character_portraits_character_id_character_public_info_characte";--> statement-breakpoint
ALTER TABLE "character_skill_queue" DROP CONSTRAINT "character_skill_queue_character_id_character_public_info_charac";--> statement-breakpoint
ALTER TABLE "character_skills" DROP CONSTRAINT "character_skills_character_id_character_public_info_character_i";--> statement-breakpoint
ALTER TABLE "character_status" DROP CONSTRAINT "character_status_character_id_character_public_info_character_i";--> statement-breakpoint
ALTER TABLE "character_wallet" DROP CONSTRAINT "character_wallet_character_id_character_public_info_character_i";--> statement-breakpoint
ALTER TABLE "character_wallet_journal" DROP CONSTRAINT "character_wallet_journal_character_id_character_public_info_cha";--> statement-breakpoint
-- Step 2: Drop unique constraints that involve character_id
ALTER TABLE "character_corporation_history" DROP CONSTRAINT "character_corporation_history_character_id_record_id_unique";--> statement-breakpoint
ALTER TABLE "character_market_orders" DROP CONSTRAINT "character_market_orders_character_id_order_id_unique";--> statement-breakpoint
ALTER TABLE "character_market_transactions" DROP CONSTRAINT "character_market_transactions_character_id_transaction_id_uniqu";--> statement-breakpoint
ALTER TABLE "character_wallet_journal" DROP CONSTRAINT "character_wallet_journal_character_id_journal_id_unique";--> statement-breakpoint
-- Step 3: Alter character_public_info.character_id first (this is the referenced column)
ALTER TABLE "character_public_info" ALTER COLUMN "character_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "character_public_info" ALTER COLUMN "corporation_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "character_public_info" ALTER COLUMN "alliance_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "character_public_info" ALTER COLUMN "race_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "character_public_info" ALTER COLUMN "bloodline_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "character_public_info" ALTER COLUMN "faction_id" SET DATA TYPE text;--> statement-breakpoint
-- Step 4: Alter child table character_id columns
ALTER TABLE "character_assets" ALTER COLUMN "character_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "character_attributes" ALTER COLUMN "character_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "character_corporation_history" ALTER COLUMN "character_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "character_location" ALTER COLUMN "character_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "character_market_orders" ALTER COLUMN "character_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "character_market_transactions" ALTER COLUMN "character_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "character_portraits" ALTER COLUMN "character_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "character_skill_queue" ALTER COLUMN "character_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "character_skills" ALTER COLUMN "character_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "character_status" ALTER COLUMN "character_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "character_wallet" ALTER COLUMN "character_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "character_wallet_journal" ALTER COLUMN "character_id" SET DATA TYPE text;--> statement-breakpoint
-- Step 5: Alter other ID columns
ALTER TABLE "character_corporation_history" ALTER COLUMN "record_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "character_corporation_history" ALTER COLUMN "corporation_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "character_location" ALTER COLUMN "solar_system_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "character_location" ALTER COLUMN "station_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "character_market_orders" ALTER COLUMN "order_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "character_market_orders" ALTER COLUMN "type_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "character_market_orders" ALTER COLUMN "location_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "character_market_orders" ALTER COLUMN "region_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "character_market_transactions" ALTER COLUMN "transaction_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "character_market_transactions" ALTER COLUMN "type_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "character_market_transactions" ALTER COLUMN "client_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "character_market_transactions" ALTER COLUMN "location_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "character_market_transactions" ALTER COLUMN "journal_ref_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "character_wallet_journal" ALTER COLUMN "journal_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "character_wallet_journal" ALTER COLUMN "first_party_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "character_wallet_journal" ALTER COLUMN "second_party_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "character_wallet_journal" ALTER COLUMN "tax_receiver_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "character_wallet_journal" ALTER COLUMN "context_id" SET DATA TYPE text;--> statement-breakpoint
-- Step 6: Recreate unique constraints
ALTER TABLE "character_corporation_history" ADD CONSTRAINT "character_corporation_history_character_id_record_id_unique" UNIQUE("character_id", "record_id");--> statement-breakpoint
ALTER TABLE "character_market_orders" ADD CONSTRAINT "character_market_orders_character_id_order_id_unique" UNIQUE("character_id", "order_id");--> statement-breakpoint
ALTER TABLE "character_market_transactions" ADD CONSTRAINT "character_market_transactions_character_id_transaction_id_uniqu" UNIQUE("character_id", "transaction_id");--> statement-breakpoint
ALTER TABLE "character_wallet_journal" ADD CONSTRAINT "character_wallet_journal_character_id_journal_id_unique" UNIQUE("character_id", "journal_id");--> statement-breakpoint
-- Step 7: Recreate foreign key constraints
ALTER TABLE "character_assets" ADD CONSTRAINT "character_assets_character_id_character_public_info_character_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."character_public_info"("character_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_attributes" ADD CONSTRAINT "character_attributes_character_id_character_public_info_character_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."character_public_info"("character_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_corporation_history" ADD CONSTRAINT "character_corporation_history_character_id_character_public_info_character_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."character_public_info"("character_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_location" ADD CONSTRAINT "character_location_character_id_character_public_info_character_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."character_public_info"("character_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_market_orders" ADD CONSTRAINT "character_market_orders_character_id_character_public_info_character_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."character_public_info"("character_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_market_transactions" ADD CONSTRAINT "character_market_transactions_character_id_character_public_info_character_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."character_public_info"("character_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_portraits" ADD CONSTRAINT "character_portraits_character_id_character_public_info_character_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."character_public_info"("character_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_skill_queue" ADD CONSTRAINT "character_skill_queue_character_id_character_public_info_character_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."character_public_info"("character_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_skills" ADD CONSTRAINT "character_skills_character_id_character_public_info_character_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."character_public_info"("character_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_status" ADD CONSTRAINT "character_status_character_id_character_public_info_character_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."character_public_info"("character_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_wallet" ADD CONSTRAINT "character_wallet_character_id_character_public_info_character_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."character_public_info"("character_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_wallet_journal" ADD CONSTRAINT "character_wallet_journal_character_id_character_public_info_character_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."character_public_info"("character_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_killmails" ADD CONSTRAINT "character_killmails_character_id_character_public_info_character_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."character_public_info"("character_id") ON DELETE no action ON UPDATE no action;
