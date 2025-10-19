CREATE TABLE "character_attributes" (
	"character_id" integer PRIMARY KEY NOT NULL,
	"intelligence" integer NOT NULL,
	"perception" integer NOT NULL,
	"memory" integer NOT NULL,
	"willpower" integer NOT NULL,
	"charisma" integer NOT NULL,
	"accrued_remap_cooldown_date" text,
	"bonus_remaps" integer,
	"last_remap_date" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "character_corporation_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"character_id" integer NOT NULL,
	"record_id" integer NOT NULL,
	"corporation_id" integer NOT NULL,
	"start_date" text NOT NULL,
	"is_deleted" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "character_corporation_history_character_id_record_id_unique" UNIQUE("character_id","record_id")
);
--> statement-breakpoint
CREATE TABLE "character_portraits" (
	"character_id" integer PRIMARY KEY NOT NULL,
	"px64x64" text,
	"px128x128" text,
	"px256x256" text,
	"px512x512" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "character_public_info" (
	"character_id" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"corporation_id" integer NOT NULL,
	"alliance_id" integer,
	"birthday" text NOT NULL,
	"race_id" integer NOT NULL,
	"bloodline_id" integer NOT NULL,
	"security_status" integer,
	"description" text,
	"gender" text NOT NULL,
	"faction_id" integer,
	"title" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "character_skills" (
	"character_id" integer PRIMARY KEY NOT NULL,
	"total_sp" integer NOT NULL,
	"unallocated_sp" integer,
	"skills" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "character_attributes" ADD CONSTRAINT "character_attributes_character_id_character_public_info_character_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."character_public_info"("character_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_corporation_history" ADD CONSTRAINT "character_corporation_history_character_id_character_public_info_character_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."character_public_info"("character_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_portraits" ADD CONSTRAINT "character_portraits_character_id_character_public_info_character_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."character_public_info"("character_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_skills" ADD CONSTRAINT "character_skills_character_id_character_public_info_character_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."character_public_info"("character_id") ON DELETE no action ON UPDATE no action;