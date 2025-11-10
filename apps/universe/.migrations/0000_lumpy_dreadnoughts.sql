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
ALTER TABLE "universe_moon_resources" ADD CONSTRAINT "universe_moon_resources_moon_id_universe_moons_id_fk" FOREIGN KEY ("moon_id") REFERENCES "public"."universe_moons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "universe_moon_resources_moon_id_idx" ON "universe_moon_resources" USING btree ("moon_id");--> statement-breakpoint
CREATE INDEX "universe_moon_resources_lookup_idx" ON "universe_moon_resources" USING btree ("product_name","ore_type_id");--> statement-breakpoint
CREATE INDEX "universe_moon_resources_covering_idx" ON "universe_moon_resources" USING btree ("moon_id","product_name","quantity");--> statement-breakpoint
CREATE INDEX "universe_moons_moon_id_idx" ON "universe_moons" USING btree ("moon_id");--> statement-breakpoint
CREATE INDEX "universe_moons_location_idx" ON "universe_moons" USING btree ("solar_system_id","planet_id");--> statement-breakpoint
CREATE INDEX "universe_moons_name_idx" ON "universe_moons" USING btree ("name");