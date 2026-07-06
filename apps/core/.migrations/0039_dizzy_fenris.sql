CREATE TABLE "sidebar_external_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text NOT NULL,
	"url" text NOT NULL,
	"icon_name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "sidebar_external_links_sort_order_idx" ON "sidebar_external_links" USING btree ("sort_order","display_name");
--> statement-breakpoint
INSERT INTO "sidebar_external_links" ("display_name", "url", "icon_name", "sort_order", "is_enabled") VALUES
	('Timerboard', 'https://timers.pleaseignore.app/', 'Timer', 0, true),
	('Wiki', 'https://wiki.pleaseignore.com/start', 'BookMarked', 1, true),
	('Forums', 'https://disc.pleaseignore.com/', 'MessageSquare', 2, true),
	('WinterCo Services', 'https://auth.wintercoalition.space/', 'Globe', 3, true);
