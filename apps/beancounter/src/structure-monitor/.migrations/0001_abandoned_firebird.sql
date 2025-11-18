CREATE TABLE `corporation_inventory_snapshots` (
	`item_id` text PRIMARY KEY NOT NULL,
	`corporation_id` text NOT NULL,
	`is_singleton` integer,
	`location_flag` text NOT NULL,
	`location_id` text NOT NULL,
	`location_type` text NOT NULL,
	`quantity` integer NOT NULL,
	`type_id` text NOT NULL,
	`is_blueprint_copy` integer DEFAULT 0 NOT NULL
);
