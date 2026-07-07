ALTER TABLE "pm_markets" ADD COLUMN "discord_thread_id" text;--> statement-breakpoint
ALTER TABLE "pm_markets" ADD COLUMN "discord_message_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "pm_markets_thread_uq" ON "pm_markets" USING btree ("discord_thread_id");