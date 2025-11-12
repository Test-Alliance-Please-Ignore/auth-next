CREATE TABLE "doctrines_doctrine_fittings" (
	"doctrine_id" uuid NOT NULL,
	"fitting_id" uuid NOT NULL,
	CONSTRAINT "doctrines_doctrine_fittings_doctrine_id_fitting_id_pk" PRIMARY KEY("doctrine_id","fitting_id")
);
--> statement-breakpoint
CREATE TABLE "doctrines_doctrines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"maintainer" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "doctrines_fitting_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fitting_id" uuid NOT NULL,
	"type_id" text NOT NULL,
	"type_name" text NOT NULL,
	"quantity" text NOT NULL,
	"flag_id" text NOT NULL,
	"flag_name" text NOT NULL,
	"group_id" text NOT NULL,
	"group_name" text NOT NULL,
	"category_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "doctrines_fittings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ship_type_id" text NOT NULL,
	"ship_name" text NOT NULL,
	"fitting" text NOT NULL,
	"category" text NOT NULL,
	"maintainer" text NOT NULL,
	"srp_eligible" boolean DEFAULT false NOT NULL,
	"srp_value" text DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "doctrines_doctrine_fittings" ADD CONSTRAINT "doctrines_doctrine_fittings_doctrine_id_doctrines_doctrines_id_fk" FOREIGN KEY ("doctrine_id") REFERENCES "public"."doctrines_doctrines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctrines_doctrine_fittings" ADD CONSTRAINT "doctrines_doctrine_fittings_fitting_id_doctrines_fittings_id_fk" FOREIGN KEY ("fitting_id") REFERENCES "public"."doctrines_fittings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctrines_fitting_items" ADD CONSTRAINT "doctrines_fitting_items_fitting_id_doctrines_fittings_id_fk" FOREIGN KEY ("fitting_id") REFERENCES "public"."doctrines_fittings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "doctrines_doctrines_name_idx" ON "doctrines_doctrines" USING btree ("name");--> statement-breakpoint
CREATE INDEX "doctrines_doctrines_category_idx" ON "doctrines_doctrines" USING btree ("category");--> statement-breakpoint
CREATE INDEX "doctrines_fitting_items_fitting_id_idx" ON "doctrines_fitting_items" USING btree ("fitting_id");--> statement-breakpoint
CREATE INDEX "doctrines_fitting_items_type_id_idx" ON "doctrines_fitting_items" USING btree ("type_id");--> statement-breakpoint
CREATE INDEX "doctrines_fitting_items_group_id_idx" ON "doctrines_fitting_items" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "doctrines_fitting_items_category_id_idx" ON "doctrines_fitting_items" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "doctrines_fittings_ship_type_id_idx" ON "doctrines_fittings" USING btree ("ship_type_id");--> statement-breakpoint
CREATE INDEX "doctrines_fittings_category_idx" ON "doctrines_fittings" USING btree ("category");