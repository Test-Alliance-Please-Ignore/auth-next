ALTER TABLE "corporation_config" ADD COLUMN "member_tracking_last_sync" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "corporation_config" ADD COLUMN "wallets_last_sync" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "corporation_config" ADD COLUMN "assets_last_sync" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "corporation_config" ADD COLUMN "structures_last_sync" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "corporation_config" ADD COLUMN "orders_last_sync" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "corporation_config" ADD COLUMN "contracts_last_sync" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "corporation_config" ADD COLUMN "industry_jobs_last_sync" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "corporation_config" ADD COLUMN "killmails_last_sync" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "corporation_config_member_tracking_last_sync_idx" ON "corporation_config" USING btree ("member_tracking_last_sync");--> statement-breakpoint
CREATE INDEX "corporation_config_wallets_last_sync_idx" ON "corporation_config" USING btree ("wallets_last_sync");--> statement-breakpoint
CREATE INDEX "corporation_config_assets_last_sync_idx" ON "corporation_config" USING btree ("assets_last_sync");--> statement-breakpoint
CREATE INDEX "corporation_config_structures_last_sync_idx" ON "corporation_config" USING btree ("structures_last_sync");--> statement-breakpoint
CREATE INDEX "corporation_config_orders_last_sync_idx" ON "corporation_config" USING btree ("orders_last_sync");--> statement-breakpoint
CREATE INDEX "corporation_config_contracts_last_sync_idx" ON "corporation_config" USING btree ("contracts_last_sync");--> statement-breakpoint
CREATE INDEX "corporation_config_industry_jobs_last_sync_idx" ON "corporation_config" USING btree ("industry_jobs_last_sync");--> statement-breakpoint
CREATE INDEX "corporation_config_killmails_last_sync_idx" ON "corporation_config" USING btree ("killmails_last_sync");