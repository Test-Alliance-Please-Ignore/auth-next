CREATE TABLE "group_discord_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"discord_server_id" uuid NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"discord_user_id" varchar(255) NOT NULL,
	"success" boolean NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "group_discord_servers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"discord_guild_id" text NOT NULL,
	"discord_guild_name" text,
	"auto_invite" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "unique_group_discord_server" UNIQUE("group_id","discord_guild_id")
);
--> statement-breakpoint
ALTER TABLE "group_discord_invites" ADD CONSTRAINT "group_discord_invites_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_discord_invites" ADD CONSTRAINT "group_discord_invites_discord_server_id_group_discord_servers_id_fk" FOREIGN KEY ("discord_server_id") REFERENCES "public"."group_discord_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_discord_servers" ADD CONSTRAINT "group_discord_servers_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "group_discord_invites_group_id_idx" ON "group_discord_invites" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "group_discord_invites_discord_server_id_idx" ON "group_discord_invites" USING btree ("discord_server_id");--> statement-breakpoint
CREATE INDEX "group_discord_invites_user_id_idx" ON "group_discord_invites" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "group_discord_invites_created_at_idx" ON "group_discord_invites" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "group_discord_servers_group_id_idx" ON "group_discord_servers" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "group_discord_servers_guild_id_idx" ON "group_discord_servers" USING btree ("discord_guild_id");--> statement-breakpoint
CREATE INDEX "group_discord_servers_auto_invite_idx" ON "group_discord_servers" USING btree ("auto_invite");