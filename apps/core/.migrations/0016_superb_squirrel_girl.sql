ALTER TABLE "users" ADD COLUMN "last_discord_refresh" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "users_last_discord_refresh_idx" ON "users" USING btree ("last_discord_refresh");