CREATE TABLE "character_killmails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"character_id" text NOT NULL,
	"killmail_id" text NOT NULL,
	"killmail_hash" text NOT NULL,
	"killmail_time" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "character_killmails_character_id_killmail_id_unique" UNIQUE("character_id","killmail_id")
);
--> statement-breakpoint
ALTER TABLE "character_killmails" ADD CONSTRAINT "character_killmails_character_id_character_public_info_character_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."character_public_info"("character_id") ON DELETE no action ON UPDATE no action;