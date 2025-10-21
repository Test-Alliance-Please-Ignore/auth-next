CREATE TABLE "notification_log" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" text NOT NULL,
	"sent_at" timestamp DEFAULT now() NOT NULL,
	"acknowledged" boolean DEFAULT false NOT NULL,
	"acknowledged_at" timestamp,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"last_retry_at" timestamp
);
