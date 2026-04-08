CREATE TABLE "discord_command_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discord_command_categories_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "discord_command_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"command_id" uuid NOT NULL,
	"permission_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discord_command_permissions_command_permission_unique" UNIQUE("command_id","permission_id")
);
--> statement-breakpoint
CREATE TABLE "discord_commands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"command_type" text DEFAULT 'static_response' NOT NULL,
	"response_template" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discord_commands_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "discord_server_commands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"discord_server_id" uuid NOT NULL,
	"command_id" uuid NOT NULL,
	"discord_command_id" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discord_server_commands_server_command_unique" UNIQUE("discord_server_id","command_id")
);
--> statement-breakpoint
ALTER TABLE "discord_command_permissions" ADD CONSTRAINT "discord_command_permissions_command_id_discord_commands_id_fk" FOREIGN KEY ("command_id") REFERENCES "public"."discord_commands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_commands" ADD CONSTRAINT "discord_commands_category_id_discord_command_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."discord_command_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_commands" ADD CONSTRAINT "discord_commands_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_server_commands" ADD CONSTRAINT "discord_server_commands_discord_server_id_discord_servers_id_fk" FOREIGN KEY ("discord_server_id") REFERENCES "public"."discord_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_server_commands" ADD CONSTRAINT "discord_server_commands_command_id_discord_commands_id_fk" FOREIGN KEY ("command_id") REFERENCES "public"."discord_commands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_server_commands" ADD CONSTRAINT "discord_server_commands_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "discord_command_categories_sort_order_idx" ON "discord_command_categories" USING btree ("sort_order","name");--> statement-breakpoint
CREATE INDEX "discord_command_permissions_command_id_idx" ON "discord_command_permissions" USING btree ("command_id");--> statement-breakpoint
CREATE INDEX "discord_command_permissions_permission_id_idx" ON "discord_command_permissions" USING btree ("permission_id");--> statement-breakpoint
CREATE INDEX "discord_commands_name_idx" ON "discord_commands" USING btree ("name");--> statement-breakpoint
CREATE INDEX "discord_commands_type_idx" ON "discord_commands" USING btree ("command_type");--> statement-breakpoint
CREATE INDEX "discord_commands_is_active_idx" ON "discord_commands" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "discord_commands_category_id_idx" ON "discord_commands" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "discord_server_commands_server_id_idx" ON "discord_server_commands" USING btree ("discord_server_id");--> statement-breakpoint
CREATE INDEX "discord_server_commands_command_id_idx" ON "discord_server_commands" USING btree ("command_id");