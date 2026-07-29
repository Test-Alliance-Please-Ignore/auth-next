CREATE TABLE "discord_self_assignable_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"discord_role_id" uuid NOT NULL,
	"default_duration_seconds" integer,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discord_self_assignable_roles_role_unique" UNIQUE("discord_role_id")
);
--> statement-breakpoint
ALTER TABLE "discord_self_assignable_roles" ADD CONSTRAINT "discord_self_assignable_roles_discord_role_id_discord_roles_id_fk" FOREIGN KEY ("discord_role_id") REFERENCES "public"."discord_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_self_assignable_roles" ADD CONSTRAINT "discord_self_assignable_roles_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "discord_self_assignable_roles_role_idx" ON "discord_self_assignable_roles" USING btree ("discord_role_id");--> statement-breakpoint
CREATE UNIQUE INDEX "discord_roles_server_name_unique" ON "discord_roles" USING btree ("discord_server_id",lower("role_name"));