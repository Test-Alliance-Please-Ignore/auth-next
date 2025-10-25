CREATE TABLE "corporation_discord_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"corporation_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"discord_user_id" varchar(255) NOT NULL,
	"success" boolean NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "managed_corporations" ADD COLUMN "discord_guild_id" varchar(255);--> statement-breakpoint
ALTER TABLE "managed_corporations" ADD COLUMN "discord_guild_name" varchar(255);--> statement-breakpoint
ALTER TABLE "managed_corporations" ADD COLUMN "discord_auto_invite" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "corporation_discord_invites" ADD CONSTRAINT "corporation_discord_invites_corporation_id_managed_corporations_corporation_id_fk" FOREIGN KEY ("corporation_id") REFERENCES "public"."managed_corporations"("corporation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporation_discord_invites" ADD CONSTRAINT "corporation_discord_invites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "corporation_discord_invites_corp_id_idx" ON "corporation_discord_invites" USING btree ("corporation_id");--> statement-breakpoint
CREATE INDEX "corporation_discord_invites_user_id_idx" ON "corporation_discord_invites" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "corporation_discord_invites_created_at_idx" ON "corporation_discord_invites" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "managed_corporations_discord_guild_id_idx" ON "managed_corporations" USING btree ("discord_guild_id");