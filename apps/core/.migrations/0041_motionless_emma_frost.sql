ALTER TABLE "corporation_discord_servers" ADD COLUMN "corp_member_role_id" uuid;--> statement-breakpoint
ALTER TABLE "corporation_discord_servers" ADD COLUMN "corp_member_auto_apply" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "corporation_discord_servers" ADD COLUMN "alliance_guest_role_id" uuid;--> statement-breakpoint
ALTER TABLE "corporation_discord_servers" ADD COLUMN "alliance_guest_auto_apply" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "corporation_discord_servers" ADD COLUMN "non_alliance_guest_role_id" uuid;--> statement-breakpoint
ALTER TABLE "corporation_discord_servers" ADD COLUMN "non_alliance_guest_auto_apply" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "corporation_discord_servers" ADD CONSTRAINT "corporation_discord_servers_corp_member_role_id_discord_roles_id_fk" FOREIGN KEY ("corp_member_role_id") REFERENCES "public"."discord_roles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporation_discord_servers" ADD CONSTRAINT "corporation_discord_servers_alliance_guest_role_id_discord_roles_id_fk" FOREIGN KEY ("alliance_guest_role_id") REFERENCES "public"."discord_roles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporation_discord_servers" ADD CONSTRAINT "corporation_discord_servers_non_alliance_guest_role_id_discord_roles_id_fk" FOREIGN KEY ("non_alliance_guest_role_id") REFERENCES "public"."discord_roles"("id") ON DELETE set null ON UPDATE no action;