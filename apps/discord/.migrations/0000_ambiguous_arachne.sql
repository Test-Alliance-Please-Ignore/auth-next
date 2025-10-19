CREATE TABLE "discord_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discord_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"username" varchar(255) NOT NULL,
	"discriminator" varchar(4) NOT NULL,
	"scopes" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "discord_users_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "discord_tokens" ADD CONSTRAINT "discord_tokens_user_id_discord_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."discord_users"("id") ON DELETE cascade ON UPDATE no action;