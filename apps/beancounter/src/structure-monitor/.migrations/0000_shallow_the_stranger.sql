CREATE TABLE `inventory_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`structure_id` text NOT NULL,
	`recorded_at` integer NOT NULL,
	`slot_name` text NOT NULL,
	`type_id` text NOT NULL,
	`quantity` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `structure_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`structure_id` text NOT NULL,
	`recorded_at` integer NOT NULL,
	`fuel_expires_at` integer,
	`services_json` text DEFAULT 'null',
	`metadata_json` text DEFAULT 'null'
);
