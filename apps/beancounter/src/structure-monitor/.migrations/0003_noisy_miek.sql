ALTER TABLE `monitor_config` ADD `initialized` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `monitor_config` ADD `last_inventory_refresh_at` integer;