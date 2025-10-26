ALTER TABLE "discord_users" ADD COLUMN "auth_revoked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "discord_users" ADD COLUMN "auth_revoked_at" timestamp;