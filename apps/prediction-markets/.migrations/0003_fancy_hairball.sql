CREATE TABLE "pm_rate_limits" (
	"user_id" uuid NOT NULL,
	"command" text NOT NULL,
	"window_start" timestamp with time zone DEFAULT now() NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "pm_rate_limits_user_id_command_pk" PRIMARY KEY("user_id","command")
);
