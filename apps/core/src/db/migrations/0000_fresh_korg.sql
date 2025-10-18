CREATE TABLE "core_account_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"legacy_system" varchar(50) NOT NULL,
	"legacy_user_id" varchar(255) NOT NULL,
	"legacy_username" varchar(255),
	"superuser" boolean DEFAULT false NOT NULL,
	"staff" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"primary_character" varchar(255),
	"primary_character_id" integer,
	"groups" text,
	"linked_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core_character_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"character_id" integer NOT NULL,
	"character_name" varchar(255),
	"is_primary" boolean DEFAULT false NOT NULL,
	"linked_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core_oidc_states" (
	"state" varchar(255) PRIMARY KEY NOT NULL,
	"session_id" varchar(64),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core_provider_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" varchar(50) NOT NULL,
	"provider_user_id" varchar(255) NOT NULL,
	"provider_username" varchar(255),
	"linked_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core_sessions" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" varchar(50),
	"provider_user_id" varchar(255),
	"email" varchar(255),
	"name" varchar(255),
	"owner_hash" varchar(255),
	"is_admin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "core_account_links" ADD CONSTRAINT "core_account_links_user_id_core_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."core_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_character_links" ADD CONSTRAINT "core_character_links_user_id_core_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."core_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_provider_links" ADD CONSTRAINT "core_provider_links_user_id_core_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."core_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_sessions" ADD CONSTRAINT "core_sessions_user_id_core_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."core_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "core_account_links_user_idx" ON "core_account_links" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "core_account_links_legacy_idx" ON "core_account_links" USING btree ("legacy_system","legacy_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "core_account_links_user_legacy_unique" ON "core_account_links" USING btree ("user_id","legacy_system");--> statement-breakpoint
CREATE INDEX "core_character_links_user_idx" ON "core_character_links" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "core_character_links_character_idx" ON "core_character_links" USING btree ("character_id");--> statement-breakpoint
CREATE INDEX "core_character_links_primary_idx" ON "core_character_links" USING btree ("user_id","is_primary");--> statement-breakpoint
CREATE INDEX "core_oidc_states_expires_idx" ON "core_oidc_states" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "core_provider_links_user_idx" ON "core_provider_links" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "core_provider_links_provider_idx" ON "core_provider_links" USING btree ("provider","provider_user_id");--> statement-breakpoint
CREATE INDEX "core_sessions_user_idx" ON "core_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "core_sessions_expires_idx" ON "core_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "core_users_provider_idx" ON "core_users" USING btree ("provider","provider_user_id");--> statement-breakpoint
CREATE INDEX "core_users_email_idx" ON "core_users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "core_users_owner_hash_idx" ON "core_users" USING btree ("owner_hash");