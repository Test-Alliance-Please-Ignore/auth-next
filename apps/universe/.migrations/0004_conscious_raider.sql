CREATE TABLE "universe_eve_type_materials" (
	"type_id" text NOT NULL,
	"material_type_id" text NOT NULL,
	"quantity" integer NOT NULL,
	CONSTRAINT "universe_eve_type_materials_type_id_material_type_id_pk" PRIMARY KEY("type_id","material_type_id")
);
--> statement-breakpoint
CREATE INDEX "universe_eve_type_materials_type_id_idx" ON "universe_eve_type_materials" USING btree ("type_id");