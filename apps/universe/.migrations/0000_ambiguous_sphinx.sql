CREATE TABLE "universe_moon_resources" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "universe_moon_resources_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"moon_id" integer NOT NULL,
	"product_name" text NOT NULL,
	"quantity" text NOT NULL,
	"ore_type_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "universe_moons" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "universe_moons_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"moon_id" text NOT NULL,
	"planet_id" text NOT NULL,
	"solar_system_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "universe_moons_name_unique" UNIQUE("name"),
	CONSTRAINT "universe_moons_moon_id_unique" UNIQUE("moon_id")
);
--> statement-breakpoint
CREATE TABLE "universe_eve_alliance_ids" (
	"alliance_id" text PRIMARY KEY NOT NULL,
	"alliance_name" text NOT NULL,
	"ticker" text
);
--> statement-breakpoint
CREATE TABLE "universe_eve_character_ids" (
	"character_id" text PRIMARY KEY NOT NULL,
	"character_name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "universe_eve_corporation_ids" (
	"corporation_id" text PRIMARY KEY NOT NULL,
	"corporation_name" text NOT NULL,
	"ticker" text
);
--> statement-breakpoint
CREATE TABLE "universe_eve_inv_categories" (
	"category_id" text PRIMARY KEY NOT NULL,
	"category_name" text NOT NULL,
	"icon_id" text,
	"published" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "universe_eve_inv_flags" (
	"flag_id" text PRIMARY KEY NOT NULL,
	"flag_name" text NOT NULL,
	"flag_text" text NOT NULL,
	"order_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "universe_eve_inv_groups" (
	"group_id" text PRIMARY KEY NOT NULL,
	"category_id" text NOT NULL,
	"group_name" text NOT NULL,
	"icon_id" text,
	"use_base_price" boolean DEFAULT false NOT NULL,
	"anchored" boolean DEFAULT false NOT NULL,
	"anchorable" boolean DEFAULT false NOT NULL,
	"fittable_non_singleton" boolean DEFAULT false NOT NULL,
	"published" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "universe_eve_inv_types" (
	"type_id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"type_name" text NOT NULL,
	"description" text NOT NULL,
	"mass" text NOT NULL,
	"volume" text NOT NULL,
	"capacity" text NOT NULL,
	"portion_size" integer NOT NULL,
	"race_id" text,
	"base_price" text,
	"published" boolean DEFAULT false NOT NULL,
	"market_group_id" text,
	"icon_id" text,
	"sound_id" text,
	"graphic_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "universe_moon_resources" ADD CONSTRAINT "universe_moon_resources_moon_id_universe_moons_id_fk" FOREIGN KEY ("moon_id") REFERENCES "public"."universe_moons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "universe_moon_resources_moon_id_idx" ON "universe_moon_resources" USING btree ("moon_id");--> statement-breakpoint
CREATE INDEX "universe_moon_resources_lookup_idx" ON "universe_moon_resources" USING btree ("product_name","ore_type_id");--> statement-breakpoint
CREATE INDEX "universe_moon_resources_covering_idx" ON "universe_moon_resources" USING btree ("moon_id","product_name","quantity");--> statement-breakpoint
CREATE INDEX "universe_moons_moon_id_idx" ON "universe_moons" USING btree ("moon_id");--> statement-breakpoint
CREATE INDEX "universe_moons_location_idx" ON "universe_moons" USING btree ("solar_system_id","planet_id");--> statement-breakpoint
CREATE INDEX "universe_moons_name_idx" ON "universe_moons" USING btree ("name");--> statement-breakpoint
CREATE INDEX "universe_eve_alliance_ids_alliance_id_idx" ON "universe_eve_alliance_ids" USING btree ("alliance_id");--> statement-breakpoint
CREATE INDEX "universe_eve_alliance_ids_alliance_name_idx" ON "universe_eve_alliance_ids" USING btree ("alliance_name");--> statement-breakpoint
CREATE INDEX "universe_eve_alliance_ids_ticker_idx" ON "universe_eve_alliance_ids" USING btree ("ticker");--> statement-breakpoint
CREATE INDEX "universe_eve_character_ids_character_id_idx" ON "universe_eve_character_ids" USING btree ("character_id");--> statement-breakpoint
CREATE INDEX "universe_eve_character_ids_character_name_idx" ON "universe_eve_character_ids" USING btree ("character_name");--> statement-breakpoint
CREATE INDEX "universe_eve_corporation_ids_corporation_id_idx" ON "universe_eve_corporation_ids" USING btree ("corporation_id");--> statement-breakpoint
CREATE INDEX "universe_eve_corporation_ids_corporation_name_idx" ON "universe_eve_corporation_ids" USING btree ("corporation_name");--> statement-breakpoint
CREATE INDEX "universe_eve_corporation_ids_ticker_idx" ON "universe_eve_corporation_ids" USING btree ("ticker");--> statement-breakpoint
CREATE INDEX "universe_eve_inv_categories_category_id_idx" ON "universe_eve_inv_categories" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "universe_eve_inv_categories_category_name_idx" ON "universe_eve_inv_categories" USING btree ("category_name");--> statement-breakpoint
CREATE INDEX "universe_eve_inv_categories_published_idx" ON "universe_eve_inv_categories" USING btree ("published");--> statement-breakpoint
CREATE INDEX "universe_eve_inv_flags_flag_id_idx" ON "universe_eve_inv_flags" USING btree ("flag_id");--> statement-breakpoint
CREATE INDEX "universe_eve_inv_flags_flag_name_idx" ON "universe_eve_inv_flags" USING btree ("flag_name");--> statement-breakpoint
CREATE INDEX "universe_eve_inv_groups_group_id_idx" ON "universe_eve_inv_groups" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "universe_eve_inv_groups_category_id_idx" ON "universe_eve_inv_groups" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "universe_eve_inv_groups_group_name_idx" ON "universe_eve_inv_groups" USING btree ("group_name");--> statement-breakpoint
CREATE INDEX "universe_eve_inv_groups_published_idx" ON "universe_eve_inv_groups" USING btree ("published");--> statement-breakpoint
CREATE INDEX "universe_eve_inv_groups_icon_id_idx" ON "universe_eve_inv_groups" USING btree ("icon_id");--> statement-breakpoint
CREATE INDEX "universe_eve_inv_types_type_id_idx" ON "universe_eve_inv_types" USING btree ("type_id");--> statement-breakpoint
CREATE INDEX "universe_eve_inv_types_group_id_idx" ON "universe_eve_inv_types" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "universe_eve_inv_types_type_name_idx" ON "universe_eve_inv_types" USING btree ("type_name");--> statement-breakpoint
CREATE INDEX "universe_eve_inv_types_published_idx" ON "universe_eve_inv_types" USING btree ("published");--> statement-breakpoint
CREATE INDEX "universe_eve_inv_types_market_group_id_idx" ON "universe_eve_inv_types" USING btree ("market_group_id");