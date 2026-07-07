CREATE TABLE "pm_forum_config" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"category_id" text NOT NULL,
	"forum_channel_id" text,
	"tag_open_id" text,
	"tag_closed_id" text,
	"tag_resolved_id" text,
	"tag_voided_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
