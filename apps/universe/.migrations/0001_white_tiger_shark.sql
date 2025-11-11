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
CREATE TABLE "universe_eve_type_ids" (
	"type_id" text PRIMARY KEY NOT NULL,
	"type_name" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "universe_eve_inv_flags_flag_id_idx" ON "universe_eve_inv_flags" USING btree ("flag_id");--> statement-breakpoint
CREATE INDEX "universe_eve_inv_flags_flag_name_idx" ON "universe_eve_inv_flags" USING btree ("flag_name");--> statement-breakpoint
CREATE INDEX "universe_eve_inv_groups_group_id_idx" ON "universe_eve_inv_groups" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "universe_eve_inv_groups_category_id_idx" ON "universe_eve_inv_groups" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "universe_eve_inv_groups_group_name_idx" ON "universe_eve_inv_groups" USING btree ("group_name");--> statement-breakpoint
CREATE INDEX "universe_eve_inv_groups_published_idx" ON "universe_eve_inv_groups" USING btree ("published");--> statement-breakpoint
CREATE INDEX "universe_eve_inv_groups_icon_id_idx" ON "universe_eve_inv_groups" USING btree ("icon_id");--> statement-breakpoint
CREATE INDEX "universe_eve_type_ids_type_id_idx" ON "universe_eve_type_ids" USING btree ("type_id");--> statement-breakpoint
CREATE INDEX "universe_eve_type_ids_type_name_idx" ON "universe_eve_type_ids" USING btree ("type_name");