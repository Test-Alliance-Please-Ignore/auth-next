CREATE TABLE "eve_characters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"character_id" bigint NOT NULL,
	"character_name" varchar(255) NOT NULL,
	"character_owner_hash" varchar(255) NOT NULL,
	"scopes" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "eve_characters_character_id_unique" UNIQUE("character_id"),
	CONSTRAINT "eve_characters_character_owner_hash_unique" UNIQUE("character_owner_hash")
);
--> statement-breakpoint
CREATE TABLE "eve_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"character_id" uuid NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "eve_tokens" ADD CONSTRAINT "eve_tokens_character_id_eve_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."eve_characters"("id") ON DELETE cascade ON UPDATE no action;