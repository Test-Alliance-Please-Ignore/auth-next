ALTER TABLE "users" ADD COLUMN "discord_user_id" varchar(255);--> statement-breakpoint
CREATE INDEX "users_discord_user_id_idx" ON "users" USING btree ("discord_user_id");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_discord_user_id_unique" UNIQUE("discord_user_id");