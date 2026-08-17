CREATE INDEX "character_market_tx_char_date_idx" ON "character_market_transactions" USING btree ("character_id","date");--> statement-breakpoint
CREATE INDEX "character_market_tx_char_num_id_idx" ON "character_market_transactions" USING btree ("character_id",("transaction_id"::numeric));--> statement-breakpoint
CREATE INDEX "character_public_info_corp_idx" ON "character_public_info" USING btree ("corporation_id");--> statement-breakpoint
CREATE INDEX "character_wallet_journal_char_num_id_idx" ON "character_wallet_journal" USING btree ("character_id",("journal_id"::numeric));