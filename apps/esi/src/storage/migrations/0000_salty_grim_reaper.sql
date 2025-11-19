CREATE TABLE `esi_cache` (
	`cache_key` text PRIMARY KEY NOT NULL,
	`data` text,
	`expires_at` integer,
	`etag` text,
	`last_modified` integer,
	`pages` integer,
	`page` integer
);
