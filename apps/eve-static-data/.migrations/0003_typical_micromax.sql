CREATE TABLE "inv_categories" (
	"category_id" text PRIMARY KEY NOT NULL,
	"category_name" text NOT NULL,
	"icon_id" integer,
	"published" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inv_groups" (
	"group_id" text PRIMARY KEY NOT NULL,
	"category_id" text NOT NULL,
	"group_name" text NOT NULL,
	"icon_id" integer,
	"use_base_price" boolean DEFAULT false NOT NULL,
	"anchored" boolean DEFAULT false NOT NULL,
	"anchorable" boolean DEFAULT false NOT NULL,
	"fittable_non_singleton" boolean DEFAULT false NOT NULL,
	"published" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inv_types" (
	"type_id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"type_name" text NOT NULL,
	"description" text,
	"mass" real NOT NULL,
	"volume" real NOT NULL,
	"capacity" real DEFAULT 0 NOT NULL,
	"portion_size" integer DEFAULT 1 NOT NULL,
	"race_id" integer,
	"base_price" text,
	"published" boolean DEFAULT true NOT NULL,
	"market_group_id" text,
	"icon_id" integer,
	"sound_id" integer,
	"graphic_id" integer
);
--> statement-breakpoint
CREATE TABLE "market_groups" (
	"market_group_id" text PRIMARY KEY NOT NULL,
	"parent_group_id" text,
	"market_group_name" text NOT NULL,
	"description" text,
	"icon_id" integer,
	"has_types" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "skill_attributes" DROP CONSTRAINT "skill_attributes_skill_id_attribute_name_unique";--> statement-breakpoint
ALTER TABLE "skill_requirements" DROP CONSTRAINT "skill_requirements_skill_id_required_skill_id_unique";--> statement-breakpoint
ALTER TABLE "skill_requirements" ALTER COLUMN "required_level" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "skills" ALTER COLUMN "rank" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "inv_groups" ADD CONSTRAINT "inv_groups_category_id_inv_categories_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."inv_categories"("category_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inv_types" ADD CONSTRAINT "inv_types_group_id_inv_groups_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."inv_groups"("group_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inv_types" ADD CONSTRAINT "inv_types_market_group_id_market_groups_market_group_id_fk" FOREIGN KEY ("market_group_id") REFERENCES "public"."market_groups"("market_group_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inv_groups_category_idx" ON "inv_groups" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "inv_types_group_idx" ON "inv_types" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "inv_types_market_group_idx" ON "inv_types" USING btree ("market_group_id");--> statement-breakpoint
CREATE INDEX "inv_types_name_idx" ON "inv_types" USING btree ("type_name");--> statement-breakpoint
CREATE INDEX "market_groups_parent_idx" ON "market_groups" USING btree ("parent_group_id");