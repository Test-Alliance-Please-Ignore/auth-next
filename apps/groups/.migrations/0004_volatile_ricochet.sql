CREATE TABLE "group_discord_server_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_discord_server_id" uuid NOT NULL,
	"discord_role_id" uuid NOT NULL,
	"role_name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "unique_group_discord_server_role" UNIQUE("group_discord_server_id","discord_role_id")
);
--> statement-breakpoint
ALTER TABLE "group_discord_servers" DROP CONSTRAINT "unique_group_discord_server";--> statement-breakpoint
ALTER TABLE "group_discord_invites" DROP CONSTRAINT "group_discord_invites_discord_server_id_group_discord_servers_id_fk";
--> statement-breakpoint
DROP INDEX "group_discord_invites_discord_server_id_idx";--> statement-breakpoint
DROP INDEX "group_discord_servers_guild_id_idx";--> statement-breakpoint
ALTER TABLE "group_discord_invites" ADD COLUMN "group_discord_server_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "group_discord_invites" ADD COLUMN "assigned_role_ids" text[];--> statement-breakpoint
ALTER TABLE "group_discord_servers" ADD COLUMN "discord_server_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "group_discord_servers" ADD COLUMN "auto_assign_roles" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "group_discord_server_roles" ADD CONSTRAINT "group_discord_server_roles_group_discord_server_id_group_discord_servers_id_fk" FOREIGN KEY ("group_discord_server_id") REFERENCES "public"."group_discord_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "group_discord_server_roles_attachment_idx" ON "group_discord_server_roles" USING btree ("group_discord_server_id");--> statement-breakpoint
ALTER TABLE "group_discord_invites" ADD CONSTRAINT "group_discord_invites_group_discord_server_id_group_discord_servers_id_fk" FOREIGN KEY ("group_discord_server_id") REFERENCES "public"."group_discord_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "group_discord_invites_server_id_idx" ON "group_discord_invites" USING btree ("group_discord_server_id");--> statement-breakpoint
CREATE INDEX "group_discord_servers_server_id_idx" ON "group_discord_servers" USING btree ("discord_server_id");--> statement-breakpoint
ALTER TABLE "group_discord_invites" DROP COLUMN "discord_server_id";--> statement-breakpoint
ALTER TABLE "group_discord_servers" DROP COLUMN "discord_guild_id";--> statement-breakpoint
ALTER TABLE "group_discord_servers" DROP COLUMN "discord_guild_name";--> statement-breakpoint
ALTER TABLE "group_discord_servers" ADD CONSTRAINT "unique_group_discord_server" UNIQUE("group_id","discord_server_id");