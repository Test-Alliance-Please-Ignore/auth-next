CREATE TABLE "corporation_directors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"corporation_id" integer NOT NULL,
	"character_id" integer NOT NULL,
	"character_name" text NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"is_healthy" boolean DEFAULT true NOT NULL,
	"last_health_check" timestamp with time zone,
	"last_used" timestamp with time zone,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"last_failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "corporation_directors_corporation_id_character_id_unique" UNIQUE("corporation_id","character_id"),
	CONSTRAINT "corporation_directors_corp_healthy_idx" UNIQUE("corporation_id","is_healthy")
);
--> statement-breakpoint
ALTER TABLE "corporation_directors" ADD CONSTRAINT "corporation_directors_corporation_id_corporation_config_corporation_id_fk" FOREIGN KEY ("corporation_id") REFERENCES "public"."corporation_config"("corporation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporation_config" DROP COLUMN "character_id";--> statement-breakpoint
ALTER TABLE "corporation_config" DROP COLUMN "character_name";