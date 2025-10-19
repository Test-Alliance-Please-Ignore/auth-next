CREATE TABLE "character_assets" (
	"character_id" integer PRIMARY KEY NOT NULL,
	"total_value" text,
	"asset_count" integer,
	"last_updated" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "character_location" (
	"character_id" integer PRIMARY KEY NOT NULL,
	"solar_system_id" integer NOT NULL,
	"station_id" integer,
	"structure_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "character_skill_queue" (
	"character_id" integer PRIMARY KEY NOT NULL,
	"queue" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "character_status" (
	"character_id" integer PRIMARY KEY NOT NULL,
	"online" boolean DEFAULT false NOT NULL,
	"last_login" timestamp with time zone,
	"last_logout" timestamp with time zone,
	"logins_count" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "character_wallet" (
	"character_id" integer PRIMARY KEY NOT NULL,
	"balance" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "character_assets" ADD CONSTRAINT "character_assets_character_id_character_public_info_character_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."character_public_info"("character_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_location" ADD CONSTRAINT "character_location_character_id_character_public_info_character_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."character_public_info"("character_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_skill_queue" ADD CONSTRAINT "character_skill_queue_character_id_character_public_info_character_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."character_public_info"("character_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_status" ADD CONSTRAINT "character_status_character_id_character_public_info_character_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."character_public_info"("character_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_wallet" ADD CONSTRAINT "character_wallet_character_id_character_public_info_character_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."character_public_info"("character_id") ON DELETE no action ON UPDATE no action;