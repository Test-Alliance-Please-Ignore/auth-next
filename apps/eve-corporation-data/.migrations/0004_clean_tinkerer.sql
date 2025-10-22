-- Drop all foreign key constraints
ALTER TABLE "character_corporation_roles" DROP CONSTRAINT IF EXISTS "character_corporation_roles_corporation_id_corporation_config_corporation_id_fk";--> statement-breakpoint
ALTER TABLE "corporation_assets" DROP CONSTRAINT IF EXISTS "corporation_assets_corporation_id_corporation_config_corporation_id_fk";--> statement-breakpoint
ALTER TABLE "corporation_contracts" DROP CONSTRAINT IF EXISTS "corporation_contracts_corporation_id_corporation_config_corporation_id_fk";--> statement-breakpoint
ALTER TABLE "corporation_directors" DROP CONSTRAINT IF EXISTS "corporation_directors_corporation_id_corporation_config_corporation_id_fk";--> statement-breakpoint
ALTER TABLE "corporation_industry_jobs" DROP CONSTRAINT IF EXISTS "corporation_industry_jobs_corporation_id_corporation_config_corporation_id_fk";--> statement-breakpoint
ALTER TABLE "corporation_killmails" DROP CONSTRAINT IF EXISTS "corporation_killmails_corporation_id_corporation_config_corporation_id_fk";--> statement-breakpoint
ALTER TABLE "corporation_member_tracking" DROP CONSTRAINT IF EXISTS "corporation_member_tracking_corporation_id_corporation_config_corporation_id_fk";--> statement-breakpoint
ALTER TABLE "corporation_members" DROP CONSTRAINT IF EXISTS "corporation_members_corporation_id_corporation_config_corporation_id_fk";--> statement-breakpoint
ALTER TABLE "corporation_orders" DROP CONSTRAINT IF EXISTS "corporation_orders_corporation_id_corporation_config_corporation_id_fk";--> statement-breakpoint
ALTER TABLE "corporation_public_info" DROP CONSTRAINT IF EXISTS "corporation_public_info_corporation_id_corporation_config_corporation_id_fk";--> statement-breakpoint
ALTER TABLE "corporation_structures" DROP CONSTRAINT IF EXISTS "corporation_structures_corporation_id_corporation_config_corporation_id_fk";--> statement-breakpoint
ALTER TABLE "corporation_wallet_journal" DROP CONSTRAINT IF EXISTS "corporation_wallet_journal_corporation_id_corporation_config_corporation_id_fk";--> statement-breakpoint
ALTER TABLE "corporation_wallet_transactions" DROP CONSTRAINT IF EXISTS "corporation_wallet_transactions_corporation_id_corporation_config_corporation_id_fk";--> statement-breakpoint
ALTER TABLE "corporation_wallets" DROP CONSTRAINT IF EXISTS "corporation_wallets_corporation_id_corporation_config_corporation_id_fk";--> statement-breakpoint

-- Alter all columns to text
ALTER TABLE "corporation_config" ALTER COLUMN "corporation_id" SET DATA TYPE text;--> statement-breakpoint

ALTER TABLE "character_corporation_roles" ALTER COLUMN "corporation_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "character_corporation_roles" ALTER COLUMN "character_id" SET DATA TYPE text;--> statement-breakpoint

ALTER TABLE "corporation_assets" ALTER COLUMN "corporation_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "corporation_assets" ALTER COLUMN "item_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "corporation_assets" ALTER COLUMN "type_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "corporation_assets" ALTER COLUMN "location_id" SET DATA TYPE text;--> statement-breakpoint

ALTER TABLE "corporation_contracts" ALTER COLUMN "corporation_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "corporation_contracts" ALTER COLUMN "contract_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "corporation_contracts" ALTER COLUMN "acceptor_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "corporation_contracts" ALTER COLUMN "assignee_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "corporation_contracts" ALTER COLUMN "issuer_corporation_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "corporation_contracts" ALTER COLUMN "issuer_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "corporation_contracts" ALTER COLUMN "start_location_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "corporation_contracts" ALTER COLUMN "end_location_id" SET DATA TYPE text;--> statement-breakpoint

ALTER TABLE "corporation_directors" ALTER COLUMN "corporation_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "corporation_directors" ALTER COLUMN "character_id" SET DATA TYPE text;--> statement-breakpoint

ALTER TABLE "corporation_industry_jobs" ALTER COLUMN "corporation_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "corporation_industry_jobs" ALTER COLUMN "job_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "corporation_industry_jobs" ALTER COLUMN "installer_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "corporation_industry_jobs" ALTER COLUMN "facility_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "corporation_industry_jobs" ALTER COLUMN "location_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "corporation_industry_jobs" ALTER COLUMN "activity_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "corporation_industry_jobs" ALTER COLUMN "blueprint_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "corporation_industry_jobs" ALTER COLUMN "blueprint_type_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "corporation_industry_jobs" ALTER COLUMN "blueprint_location_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "corporation_industry_jobs" ALTER COLUMN "output_location_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "corporation_industry_jobs" ALTER COLUMN "product_type_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "corporation_industry_jobs" ALTER COLUMN "completed_character_id" SET DATA TYPE text;--> statement-breakpoint

ALTER TABLE "corporation_killmails" ALTER COLUMN "corporation_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "corporation_killmails" ALTER COLUMN "killmail_id" SET DATA TYPE text;--> statement-breakpoint

ALTER TABLE "corporation_member_tracking" ALTER COLUMN "corporation_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "corporation_member_tracking" ALTER COLUMN "character_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "corporation_member_tracking" ALTER COLUMN "location_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "corporation_member_tracking" ALTER COLUMN "base_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "corporation_member_tracking" ALTER COLUMN "ship_type_id" SET DATA TYPE text;--> statement-breakpoint

ALTER TABLE "corporation_members" ALTER COLUMN "corporation_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "corporation_members" ALTER COLUMN "character_id" SET DATA TYPE text;--> statement-breakpoint

ALTER TABLE "corporation_orders" ALTER COLUMN "corporation_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "corporation_orders" ALTER COLUMN "order_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "corporation_orders" ALTER COLUMN "type_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "corporation_orders" ALTER COLUMN "location_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "corporation_orders" ALTER COLUMN "region_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "corporation_orders" ALTER COLUMN "issued_by" SET DATA TYPE text;--> statement-breakpoint

ALTER TABLE "corporation_public_info" ALTER COLUMN "corporation_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "corporation_public_info" ALTER COLUMN "alliance_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "corporation_public_info" ALTER COLUMN "ceo_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "corporation_public_info" ALTER COLUMN "creator_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "corporation_public_info" ALTER COLUMN "faction_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "corporation_public_info" ALTER COLUMN "home_station_id" SET DATA TYPE text;--> statement-breakpoint

ALTER TABLE "corporation_structures" ALTER COLUMN "corporation_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "corporation_structures" ALTER COLUMN "structure_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "corporation_structures" ALTER COLUMN "system_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "corporation_structures" ALTER COLUMN "type_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "corporation_structures" ALTER COLUMN "profile_id" SET DATA TYPE text;--> statement-breakpoint

ALTER TABLE "corporation_wallet_journal" ALTER COLUMN "corporation_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "corporation_wallet_journal" ALTER COLUMN "journal_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "corporation_wallet_journal" ALTER COLUMN "first_party_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "corporation_wallet_journal" ALTER COLUMN "second_party_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "corporation_wallet_journal" ALTER COLUMN "tax_receiver_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "corporation_wallet_journal" ALTER COLUMN "context_id" SET DATA TYPE text;--> statement-breakpoint

ALTER TABLE "corporation_wallet_transactions" ALTER COLUMN "corporation_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "corporation_wallet_transactions" ALTER COLUMN "transaction_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "corporation_wallet_transactions" ALTER COLUMN "client_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "corporation_wallet_transactions" ALTER COLUMN "location_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "corporation_wallet_transactions" ALTER COLUMN "type_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "corporation_wallet_transactions" ALTER COLUMN "journal_ref_id" SET DATA TYPE text;--> statement-breakpoint

ALTER TABLE "corporation_wallets" ALTER COLUMN "corporation_id" SET DATA TYPE text;--> statement-breakpoint

-- Recreate foreign key constraints
ALTER TABLE "character_corporation_roles" ADD CONSTRAINT "character_corporation_roles_corporation_id_corporation_config_corporation_id_fk" FOREIGN KEY ("corporation_id") REFERENCES "corporation_config"("corporation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporation_assets" ADD CONSTRAINT "corporation_assets_corporation_id_corporation_config_corporation_id_fk" FOREIGN KEY ("corporation_id") REFERENCES "corporation_config"("corporation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporation_contracts" ADD CONSTRAINT "corporation_contracts_corporation_id_corporation_config_corporation_id_fk" FOREIGN KEY ("corporation_id") REFERENCES "corporation_config"("corporation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporation_directors" ADD CONSTRAINT "corporation_directors_corporation_id_corporation_config_corporation_id_fk" FOREIGN KEY ("corporation_id") REFERENCES "corporation_config"("corporation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporation_industry_jobs" ADD CONSTRAINT "corporation_industry_jobs_corporation_id_corporation_config_corporation_id_fk" FOREIGN KEY ("corporation_id") REFERENCES "corporation_config"("corporation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporation_killmails" ADD CONSTRAINT "corporation_killmails_corporation_id_corporation_config_corporation_id_fk" FOREIGN KEY ("corporation_id") REFERENCES "corporation_config"("corporation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporation_member_tracking" ADD CONSTRAINT "corporation_member_tracking_corporation_id_corporation_config_corporation_id_fk" FOREIGN KEY ("corporation_id") REFERENCES "corporation_config"("corporation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporation_members" ADD CONSTRAINT "corporation_members_corporation_id_corporation_config_corporation_id_fk" FOREIGN KEY ("corporation_id") REFERENCES "corporation_config"("corporation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporation_orders" ADD CONSTRAINT "corporation_orders_corporation_id_corporation_config_corporation_id_fk" FOREIGN KEY ("corporation_id") REFERENCES "corporation_config"("corporation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporation_public_info" ADD CONSTRAINT "corporation_public_info_corporation_id_corporation_config_corporation_id_fk" FOREIGN KEY ("corporation_id") REFERENCES "corporation_config"("corporation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporation_structures" ADD CONSTRAINT "corporation_structures_corporation_id_corporation_config_corporation_id_fk" FOREIGN KEY ("corporation_id") REFERENCES "corporation_config"("corporation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporation_wallet_journal" ADD CONSTRAINT "corporation_wallet_journal_corporation_id_corporation_config_corporation_id_fk" FOREIGN KEY ("corporation_id") REFERENCES "corporation_config"("corporation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporation_wallet_transactions" ADD CONSTRAINT "corporation_wallet_transactions_corporation_id_corporation_config_corporation_id_fk" FOREIGN KEY ("corporation_id") REFERENCES "corporation_config"("corporation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporation_wallets" ADD CONSTRAINT "corporation_wallets_corporation_id_corporation_config_corporation_id_fk" FOREIGN KEY ("corporation_id") REFERENCES "corporation_config"("corporation_id") ON DELETE no action ON UPDATE no action;
