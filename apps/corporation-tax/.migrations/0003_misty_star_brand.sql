CREATE INDEX "tax_assess_corp_end_id_idx" ON "tax_assessments" USING btree ("corporation_id","tax_period_end","id");--> statement-breakpoint
CREATE INDEX "tax_disc_corp_created_id_idx" ON "tax_discrepancies" USING btree ("corporation_id","created_at","id");--> statement-breakpoint
CREATE INDEX "tax_ledger_corp_date_id_idx" ON "tax_ledger_entries" USING btree ("corporation_id","entry_date","id");--> statement-breakpoint
CREATE INDEX "tax_final_corp_date_end_idx" ON "tax_member_contribution_finalized_rollups" USING btree ("corporation_id","rollup_date","period_end");--> statement-breakpoint
CREATE INDEX "tax_proj_corp_date_end_idx" ON "tax_member_contribution_projection_rollups" USING btree ("corporation_id","rollup_date","period_end");--> statement-breakpoint
ALTER TABLE "tax_assessments" DROP COLUMN "portal_tax_rate_bps";