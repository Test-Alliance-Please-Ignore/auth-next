CREATE TABLE "doctrines_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "doctrines_doctrine_staging_systems" (
	"doctrine_id" uuid NOT NULL,
	"staging_system_id" uuid NOT NULL,
	"note" text DEFAULT 'X' NOT NULL,
	CONSTRAINT "doctrines_doctrine_staging_systems_doctrine_id_staging_system_id_pk" PRIMARY KEY("doctrine_id","staging_system_id")
);
--> statement-breakpoint
CREATE TABLE "doctrines_staging_systems" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"solar_system_id" text NOT NULL,
	"solar_system_name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "doctrines_doctrines" ADD COLUMN "category_id" uuid;--> statement-breakpoint
ALTER TABLE "doctrines_doctrine_staging_systems" ADD CONSTRAINT "doctrines_doctrine_staging_systems_doctrine_id_doctrines_doctrines_id_fk" FOREIGN KEY ("doctrine_id") REFERENCES "public"."doctrines_doctrines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctrines_doctrine_staging_systems" ADD CONSTRAINT "doctrines_doctrine_staging_systems_staging_system_id_doctrines_staging_systems_id_fk" FOREIGN KEY ("staging_system_id") REFERENCES "public"."doctrines_staging_systems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctrines_doctrines" ADD CONSTRAINT "doctrines_doctrines_category_id_doctrines_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."doctrines_categories"("id") ON DELETE set null ON UPDATE no action;