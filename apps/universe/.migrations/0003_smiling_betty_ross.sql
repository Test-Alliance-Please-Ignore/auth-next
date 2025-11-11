CREATE TABLE "universe_eve_inv_items" (
	"item_id" text PRIMARY KEY NOT NULL,
	"type_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"location_id" text NOT NULL,
	"flag_id" text NOT NULL,
	"quantity" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "universe_eve_inv_names" (
	"item_id" text PRIMARY KEY NOT NULL,
	"item_name" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "universe_eve_inv_items_item_id_idx" ON "universe_eve_inv_items" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "universe_eve_inv_items_type_id_idx" ON "universe_eve_inv_items" USING btree ("type_id");--> statement-breakpoint
CREATE INDEX "universe_eve_inv_items_owner_id_idx" ON "universe_eve_inv_items" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "universe_eve_inv_items_location_id_idx" ON "universe_eve_inv_items" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "universe_eve_inv_names_item_id_idx" ON "universe_eve_inv_names" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "universe_eve_inv_names_item_name_idx" ON "universe_eve_inv_names" USING btree ("item_name");