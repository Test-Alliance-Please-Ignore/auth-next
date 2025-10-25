CREATE TABLE "corporation_discord_server_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"corporation_discord_server_id" uuid NOT NULL,
	"discord_role_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unique_corp_discord_server_role" UNIQUE("corporation_discord_server_id","discord_role_id")
);
--> statement-breakpoint
CREATE TABLE "corporation_discord_servers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"corporation_id" text NOT NULL,
	"discord_server_id" uuid NOT NULL,
	"auto_invite" boolean DEFAULT false NOT NULL,
	"auto_assign_roles" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unique_corp_discord_server" UNIQUE("corporation_id","discord_server_id")
);
--> statement-breakpoint
CREATE TABLE "discord_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"discord_server_id" uuid NOT NULL,
	"role_id" text NOT NULL,
	"role_name" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unique_discord_server_role" UNIQUE("discord_server_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "discord_servers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"guild_name" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discord_servers_guild_id_unique" UNIQUE("guild_id")
);
--> statement-breakpoint
DROP INDEX "managed_corporations_discord_guild_id_idx";--> statement-breakpoint
ALTER TABLE "corporation_discord_invites" ADD COLUMN "corporation_discord_server_id" uuid;--> statement-breakpoint
ALTER TABLE "corporation_discord_invites" ADD COLUMN "assigned_role_ids" text[];--> statement-breakpoint
ALTER TABLE "corporation_discord_server_roles" ADD CONSTRAINT "corporation_discord_server_roles_corporation_discord_server_id_corporation_discord_servers_id_fk" FOREIGN KEY ("corporation_discord_server_id") REFERENCES "public"."corporation_discord_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporation_discord_server_roles" ADD CONSTRAINT "corporation_discord_server_roles_discord_role_id_discord_roles_id_fk" FOREIGN KEY ("discord_role_id") REFERENCES "public"."discord_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporation_discord_servers" ADD CONSTRAINT "corporation_discord_servers_corporation_id_managed_corporations_corporation_id_fk" FOREIGN KEY ("corporation_id") REFERENCES "public"."managed_corporations"("corporation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporation_discord_servers" ADD CONSTRAINT "corporation_discord_servers_discord_server_id_discord_servers_id_fk" FOREIGN KEY ("discord_server_id") REFERENCES "public"."discord_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_roles" ADD CONSTRAINT "discord_roles_discord_server_id_discord_servers_id_fk" FOREIGN KEY ("discord_server_id") REFERENCES "public"."discord_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_servers" ADD CONSTRAINT "discord_servers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "corp_discord_server_roles_attachment_idx" ON "corporation_discord_server_roles" USING btree ("corporation_discord_server_id");--> statement-breakpoint
CREATE INDEX "corp_discord_servers_corp_id_idx" ON "corporation_discord_servers" USING btree ("corporation_id");--> statement-breakpoint
CREATE INDEX "corp_discord_servers_server_id_idx" ON "corporation_discord_servers" USING btree ("discord_server_id");--> statement-breakpoint
CREATE INDEX "discord_roles_server_id_idx" ON "discord_roles" USING btree ("discord_server_id");--> statement-breakpoint
CREATE INDEX "discord_servers_guild_id_idx" ON "discord_servers" USING btree ("guild_id");--> statement-breakpoint
ALTER TABLE "corporation_discord_invites" ADD CONSTRAINT "corporation_discord_invites_corporation_discord_server_id_corporation_discord_servers_id_fk" FOREIGN KEY ("corporation_discord_server_id") REFERENCES "public"."corporation_discord_servers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "corporation_discord_invites_server_id_idx" ON "corporation_discord_invites" USING btree ("corporation_discord_server_id");--> statement-breakpoint
ALTER TABLE "managed_corporations" DROP COLUMN "discord_guild_id";--> statement-breakpoint
ALTER TABLE "managed_corporations" DROP COLUMN "discord_guild_name";--> statement-breakpoint
ALTER TABLE "managed_corporations" DROP COLUMN "discord_auto_invite";