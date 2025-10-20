ALTER TABLE "discord_users" ADD COLUMN "core_user_id" varchar(255);--> statement-breakpoint
ALTER TABLE "discord_users" ADD CONSTRAINT "discord_users_core_user_id_unique" UNIQUE("core_user_id");