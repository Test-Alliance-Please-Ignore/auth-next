ALTER TABLE "corporation_contracts" DROP CONSTRAINT "corporation_contracts_corporation_id_contract_id_unique";--> statement-breakpoint
ALTER TABLE "corporation_contracts" DROP CONSTRAINT "corporation_contracts_corporation_id_corporation_config_corporation_id_fk";
--> statement-breakpoint
CREATE INDEX "corporation_contracts_leaderboard_all_time_idx" ON "corporation_contracts" USING btree ("assignee_id","type","status","acceptor_id");--> statement-breakpoint
CREATE INDEX "corporation_contracts_leaderboard_period_idx" ON "corporation_contracts" USING btree ("assignee_id","type","status","date_completed","acceptor_id");--> statement-breakpoint
ALTER TABLE "corporation_contracts" DROP COLUMN "corporation_id";--> statement-breakpoint
ALTER TABLE "corporation_contracts" ADD CONSTRAINT "corporation_contracts_contract_id_unique" UNIQUE("contract_id");