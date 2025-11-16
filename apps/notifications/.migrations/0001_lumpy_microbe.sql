CREATE TABLE "notifications_user_config" (
	"user_id" text NOT NULL,
	"notification_type" text NOT NULL,
	"event_type" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"notify_count" integer DEFAULT 0 NOT NULL,
	"last_notified_at" timestamp
);
