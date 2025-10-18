CREATE TABLE "esi_alliances" (
	"alliance_id" integer PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"ticker" varchar(10) NOT NULL,
	"creator_id" integer,
	"creator_corporation_id" integer,
	"date_founded" varchar(50),
	"executor_corporation_id" integer,
	"last_updated" timestamp DEFAULT now() NOT NULL,
	"next_update_at" timestamp,
	"update_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "esi_character_assets" (
	"character_id" integer NOT NULL,
	"item_id" bigint NOT NULL,
	"type_id" integer NOT NULL,
	"quantity" integer NOT NULL,
	"location_id" bigint NOT NULL,
	"location_type" varchar(50) NOT NULL,
	"location_flag" varchar(50) NOT NULL,
	"is_singleton" boolean NOT NULL,
	"is_blueprint_copy" boolean,
	"last_updated" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "esi_character_assets_character_id_item_id_pk" PRIMARY KEY("character_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "esi_character_history" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "esi_character_history_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"character_id" integer NOT NULL,
	"changed_at" timestamp DEFAULT now() NOT NULL,
	"field_name" varchar(50) NOT NULL,
	"old_value" text,
	"new_value" text
);
--> statement-breakpoint
CREATE TABLE "esi_character_location" (
	"character_id" integer PRIMARY KEY NOT NULL,
	"solar_system_id" integer NOT NULL,
	"station_id" bigint,
	"structure_id" bigint,
	"last_updated" timestamp DEFAULT now() NOT NULL,
	"next_update_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "esi_character_online" (
	"character_id" integer PRIMARY KEY NOT NULL,
	"online" boolean NOT NULL,
	"last_login" timestamp,
	"last_logout" timestamp,
	"logins" integer,
	"last_updated" timestamp DEFAULT now() NOT NULL,
	"next_update_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "esi_character_skills" (
	"character_id" integer PRIMARY KEY NOT NULL,
	"total_sp" bigint,
	"unallocated_sp" bigint,
	"last_updated" timestamp DEFAULT now() NOT NULL,
	"next_update_at" timestamp,
	"update_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "esi_characters" (
	"character_id" integer PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"corporation_id" integer NOT NULL,
	"alliance_id" integer,
	"security_status" real,
	"birthday" varchar(50),
	"gender" varchar(20),
	"race_id" integer,
	"bloodline_id" integer,
	"ancestry_id" integer,
	"description" text,
	"wallet_balance" bigint,
	"wallet_updated_at" timestamp,
	"last_updated" timestamp DEFAULT now() NOT NULL,
	"next_update_at" timestamp,
	"update_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "esi_corporation_history" (
	"character_id" integer NOT NULL,
	"record_id" integer NOT NULL,
	"corporation_id" integer NOT NULL,
	"corporation_name" varchar(255),
	"corporation_ticker" varchar(10),
	"alliance_id" integer,
	"alliance_name" varchar(255),
	"alliance_ticker" varchar(10),
	"start_date" varchar(50) NOT NULL,
	"end_date" varchar(50),
	"is_deleted" boolean DEFAULT false NOT NULL,
	"last_updated" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "esi_corporation_history_character_id_record_id_pk" PRIMARY KEY("character_id","record_id")
);
--> statement-breakpoint
CREATE TABLE "esi_corporation_history_metadata" (
	"character_id" integer PRIMARY KEY NOT NULL,
	"last_fetched" timestamp DEFAULT now() NOT NULL,
	"next_fetch_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "esi_corporations" (
	"corporation_id" integer PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"ticker" varchar(10) NOT NULL,
	"member_count" integer,
	"ceo_id" integer,
	"creator_id" integer,
	"date_founded" varchar(50),
	"tax_rate" real,
	"url" text,
	"description" text,
	"alliance_id" integer,
	"last_updated" timestamp DEFAULT now() NOT NULL,
	"next_update_at" timestamp,
	"update_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "esi_skillqueue" (
	"character_id" integer NOT NULL,
	"skill_id" integer NOT NULL,
	"finished_level" integer NOT NULL,
	"queue_position" integer NOT NULL,
	"start_date" varchar(50),
	"finish_date" varchar(50),
	"training_start_sp" bigint,
	"level_start_sp" bigint,
	"level_end_sp" bigint,
	CONSTRAINT "esi_skillqueue_character_id_queue_position_pk" PRIMARY KEY("character_id","queue_position")
);
--> statement-breakpoint
CREATE TABLE "esi_skills" (
	"character_id" integer NOT NULL,
	"skill_id" integer NOT NULL,
	"skillpoints_in_skill" bigint NOT NULL,
	"trained_skill_level" integer NOT NULL,
	"active_skill_level" integer NOT NULL,
	CONSTRAINT "esi_skills_character_id_skill_id_pk" PRIMARY KEY("character_id","skill_id")
);
--> statement-breakpoint
CREATE INDEX "esi_alliances_next_update_idx" ON "esi_alliances" USING btree ("next_update_at");--> statement-breakpoint
CREATE INDEX "esi_assets_character_idx" ON "esi_character_assets" USING btree ("character_id");--> statement-breakpoint
CREATE INDEX "esi_assets_type_idx" ON "esi_character_assets" USING btree ("type_id");--> statement-breakpoint
CREATE INDEX "esi_assets_location_idx" ON "esi_character_assets" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "esi_character_history_character_idx" ON "esi_character_history" USING btree ("character_id");--> statement-breakpoint
CREATE INDEX "esi_character_history_changed_idx" ON "esi_character_history" USING btree ("changed_at");--> statement-breakpoint
CREATE INDEX "esi_character_location_next_update_idx" ON "esi_character_location" USING btree ("next_update_at");--> statement-breakpoint
CREATE INDEX "esi_character_online_next_update_idx" ON "esi_character_online" USING btree ("next_update_at");--> statement-breakpoint
CREATE INDEX "esi_character_skills_next_update_idx" ON "esi_character_skills" USING btree ("next_update_at");--> statement-breakpoint
CREATE INDEX "esi_characters_corp_idx" ON "esi_characters" USING btree ("corporation_id");--> statement-breakpoint
CREATE INDEX "esi_characters_alliance_idx" ON "esi_characters" USING btree ("alliance_id");--> statement-breakpoint
CREATE INDEX "esi_characters_next_update_idx" ON "esi_characters" USING btree ("next_update_at");--> statement-breakpoint
CREATE INDEX "esi_corp_history_character_idx" ON "esi_corporation_history" USING btree ("character_id");--> statement-breakpoint
CREATE INDEX "esi_corp_history_corp_idx" ON "esi_corporation_history" USING btree ("corporation_id");--> statement-breakpoint
CREATE INDEX "esi_corp_history_alliance_idx" ON "esi_corporation_history" USING btree ("alliance_id");--> statement-breakpoint
CREATE INDEX "esi_corporations_alliance_idx" ON "esi_corporations" USING btree ("alliance_id");--> statement-breakpoint
CREATE INDEX "esi_corporations_next_update_idx" ON "esi_corporations" USING btree ("next_update_at");--> statement-breakpoint
CREATE INDEX "esi_skillqueue_character_idx" ON "esi_skillqueue" USING btree ("character_id");--> statement-breakpoint
CREATE INDEX "esi_skills_character_idx" ON "esi_skills" USING btree ("character_id");