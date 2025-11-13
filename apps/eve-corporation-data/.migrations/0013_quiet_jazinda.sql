ALTER TABLE "corporation_config" ADD COLUMN "wallet_journal_last_sync" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "corporation_config" ADD COLUMN "wallet_transactions_last_sync" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "corporation_config_wallet_transactions_last_sync_idx" ON "corporation_config" USING btree ("wallet_transactions_last_sync");--> statement-breakpoint
CREATE INDEX "corporation_config_wallet_journal_last_sync_idx" ON "corporation_config" USING btree ("wallet_journal_last_sync");