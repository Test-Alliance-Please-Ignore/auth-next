CREATE TABLE "corporation_discord_server_nickname_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"corporation_discord_server_id" uuid NOT NULL,
	"bucket" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"source" text DEFAULT 'corp' NOT NULL,
	"custom_ticker" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unique_corp_discord_server_nickname_config" UNIQUE("corporation_discord_server_id","bucket")
);
--> statement-breakpoint
CREATE TABLE "corporation_discord_server_scenario_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"corporation_discord_server_id" uuid NOT NULL,
	"bucket" text NOT NULL,
	"discord_role_id" uuid,
	"auto_apply" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unique_corp_discord_server_scenario_role" UNIQUE("corporation_discord_server_id","bucket")
);
--> statement-breakpoint
ALTER TABLE "corporation_discord_servers" DROP CONSTRAINT "corporation_discord_servers_corp_member_role_id_discord_roles_id_fk";
--> statement-breakpoint
ALTER TABLE "corporation_discord_servers" DROP CONSTRAINT "corporation_discord_servers_alliance_guest_role_id_discord_roles_id_fk";
--> statement-breakpoint
ALTER TABLE "corporation_discord_servers" DROP CONSTRAINT "corporation_discord_servers_non_alliance_guest_role_id_discord_roles_id_fk";
--> statement-breakpoint
ALTER TABLE "corporation_discord_server_nickname_configs" ADD CONSTRAINT "corporation_discord_server_nickname_configs_corporation_discord_server_id_corporation_discord_servers_id_fk" FOREIGN KEY ("corporation_discord_server_id") REFERENCES "public"."corporation_discord_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporation_discord_server_scenario_roles" ADD CONSTRAINT "corporation_discord_server_scenario_roles_corporation_discord_server_id_corporation_discord_servers_id_fk" FOREIGN KEY ("corporation_discord_server_id") REFERENCES "public"."corporation_discord_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporation_discord_server_scenario_roles" ADD CONSTRAINT "corporation_discord_server_scenario_roles_discord_role_id_discord_roles_id_fk" FOREIGN KEY ("discord_role_id") REFERENCES "public"."discord_roles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "corp_discord_server_nickname_configs_attachment_idx" ON "corporation_discord_server_nickname_configs" USING btree ("corporation_discord_server_id");--> statement-breakpoint
CREATE INDEX "corp_discord_server_scenario_roles_attachment_idx" ON "corporation_discord_server_scenario_roles" USING btree ("corporation_discord_server_id");--> statement-breakpoint
ALTER TABLE "corporation_discord_servers" DROP COLUMN "corp_member_role_id";--> statement-breakpoint
ALTER TABLE "corporation_discord_servers" DROP COLUMN "corp_member_auto_apply";--> statement-breakpoint
ALTER TABLE "corporation_discord_servers" DROP COLUMN "alliance_guest_role_id";--> statement-breakpoint
ALTER TABLE "corporation_discord_servers" DROP COLUMN "alliance_guest_auto_apply";--> statement-breakpoint
ALTER TABLE "corporation_discord_servers" DROP COLUMN "non_alliance_guest_role_id";--> statement-breakpoint
ALTER TABLE "corporation_discord_servers" DROP COLUMN "non_alliance_guest_auto_apply";