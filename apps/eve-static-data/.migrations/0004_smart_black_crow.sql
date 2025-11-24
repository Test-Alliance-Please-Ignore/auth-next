CREATE TABLE "dgm_attribute_categories" (
	"category_id" text PRIMARY KEY NOT NULL,
	"category_name" text NOT NULL,
	"category_description" text
);
--> statement-breakpoint
CREATE TABLE "dgm_attribute_types" (
	"attribute_id" text PRIMARY KEY NOT NULL,
	"attribute_name" text,
	"description" text NOT NULL,
	"icon_id" integer,
	"default_value" real DEFAULT 0 NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"display_name" text,
	"unit_id" integer,
	"stackable" boolean DEFAULT false NOT NULL,
	"high_is_good" boolean DEFAULT false NOT NULL,
	"category_id" text
);
--> statement-breakpoint
CREATE TABLE "dgm_type_attributes" (
	"type_id" text NOT NULL,
	"attribute_id" text NOT NULL,
	"value_int" integer,
	"value_float" real
);
--> statement-breakpoint
ALTER TABLE "dgm_attribute_types" ADD CONSTRAINT "dgm_attribute_types_category_id_dgm_attribute_categories_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."dgm_attribute_categories"("category_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dgm_type_attributes" ADD CONSTRAINT "dgm_type_attributes_type_id_inv_types_type_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."inv_types"("type_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dgm_type_attributes" ADD CONSTRAINT "dgm_type_attributes_attribute_id_dgm_attribute_types_attribute_id_fk" FOREIGN KEY ("attribute_id") REFERENCES "public"."dgm_attribute_types"("attribute_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dgm_attribute_types_category_idx" ON "dgm_attribute_types" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "dgm_type_attributes_type_idx" ON "dgm_type_attributes" USING btree ("type_id");--> statement-breakpoint
CREATE INDEX "dgm_type_attributes_attribute_idx" ON "dgm_type_attributes" USING btree ("attribute_id");