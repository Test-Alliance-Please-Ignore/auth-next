CREATE TABLE "universe_eve_dogma_attributes" (
	"attribute_id" text PRIMARY KEY NOT NULL,
	"attribute_category_id" text,
	"data_type" integer,
	"default_value" text,
	"attribute_name" text NOT NULL,
	"display_name" text,
	"description" text,
	"display_when_zero" boolean,
	"high_is_good" boolean,
	"published" boolean,
	"stackable" boolean,
	"unit_id" text
);
--> statement-breakpoint
CREATE TABLE "universe_eve_dogma_effect_modifiers" (
	"effect_id" text NOT NULL,
	"modifier_index" integer NOT NULL,
	"domain" text,
	"func" text,
	"group_id" text,
	"modified_attribute_id" text,
	"modifying_attribute_id" text,
	"operation" integer,
	"skill_type_id" text,
	CONSTRAINT "universe_eve_dogma_effect_modifiers_effect_id_modifier_index_pk" PRIMARY KEY("effect_id","modifier_index")
);
--> statement-breakpoint
CREATE TABLE "universe_eve_dogma_effects" (
	"effect_id" text PRIMARY KEY NOT NULL,
	"effect_name" text NOT NULL,
	"description" text,
	"display_name" text,
	"effect_category_id" integer,
	"published" boolean
);
--> statement-breakpoint
CREATE TABLE "universe_eve_dogma_units" (
	"unit_id" text PRIMARY KEY NOT NULL,
	"unit_name" text NOT NULL,
	"display_name" text,
	"description" text
);
--> statement-breakpoint
CREATE TABLE "universe_eve_type_dogma_attributes" (
	"type_id" text NOT NULL,
	"attribute_id" text NOT NULL,
	"value" text NOT NULL,
	CONSTRAINT "universe_eve_type_dogma_attributes_type_id_attribute_id_pk" PRIMARY KEY("type_id","attribute_id")
);
--> statement-breakpoint
CREATE TABLE "universe_eve_type_dogma_effects" (
	"type_id" text NOT NULL,
	"effect_id" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	CONSTRAINT "universe_eve_type_dogma_effects_type_id_effect_id_pk" PRIMARY KEY("type_id","effect_id")
);
--> statement-breakpoint
CREATE INDEX "universe_eve_dogma_attributes_attribute_id_idx" ON "universe_eve_dogma_attributes" USING btree ("attribute_id");--> statement-breakpoint
CREATE INDEX "universe_eve_dogma_attributes_attribute_name_idx" ON "universe_eve_dogma_attributes" USING btree ("attribute_name");--> statement-breakpoint
CREATE INDEX "universe_eve_dogma_attributes_unit_id_idx" ON "universe_eve_dogma_attributes" USING btree ("unit_id");--> statement-breakpoint
CREATE INDEX "universe_eve_dogma_effect_modifiers_effect_id_idx" ON "universe_eve_dogma_effect_modifiers" USING btree ("effect_id");--> statement-breakpoint
CREATE INDEX "universe_eve_dogma_effect_modifiers_target_idx" ON "universe_eve_dogma_effect_modifiers" USING btree ("modified_attribute_id","modifying_attribute_id","operation","func","group_id");--> statement-breakpoint
CREATE INDEX "universe_eve_dogma_effects_effect_id_idx" ON "universe_eve_dogma_effects" USING btree ("effect_id");--> statement-breakpoint
CREATE INDEX "universe_eve_dogma_effects_effect_name_idx" ON "universe_eve_dogma_effects" USING btree ("effect_name");--> statement-breakpoint
CREATE INDEX "universe_eve_dogma_units_unit_id_idx" ON "universe_eve_dogma_units" USING btree ("unit_id");--> statement-breakpoint
CREATE INDEX "universe_eve_dogma_units_unit_name_idx" ON "universe_eve_dogma_units" USING btree ("unit_name");--> statement-breakpoint
CREATE INDEX "universe_eve_type_dogma_attributes_attribute_type_idx" ON "universe_eve_type_dogma_attributes" USING btree ("attribute_id","type_id");--> statement-breakpoint
CREATE INDEX "universe_eve_type_dogma_effects_effect_type_idx" ON "universe_eve_type_dogma_effects" USING btree ("effect_id","type_id");