DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_type t
		JOIN pg_namespace n ON n.oid = t.typnamespace
		WHERE t.typname = 'tax_alert_severity'
			AND n.nspname = 'public'
	) THEN
		CREATE TYPE "public"."tax_alert_severity" AS ENUM('critical', 'warning', 'info');
	END IF;
END $$;
--> statement-breakpoint

DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_type t
		JOIN pg_namespace n ON n.oid = t.typnamespace
		WHERE t.typname = 'tax_alert_status'
			AND n.nspname = 'public'
	) THEN
		CREATE TYPE "public"."tax_alert_status" AS ENUM('open', 'acknowledged', 'resolved');
	END IF;
END $$;
--> statement-breakpoint

DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_type t
		JOIN pg_namespace n ON n.oid = t.typnamespace
		WHERE t.typname = 'tax_alert_discord_delivery_status'
			AND n.nspname = 'public'
	) THEN
		CREATE TYPE "public"."tax_alert_discord_delivery_status" AS ENUM(
			'pending',
			'sent',
			'failed',
			'skipped'
		);
	END IF;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "tax_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"corporation_id" text,
	"alert_type" text NOT NULL,
	"severity" "tax_alert_severity" NOT NULL DEFAULT 'info',
	"status" "tax_alert_status" NOT NULL DEFAULT 'open',
	"dedupe_key" text NOT NULL,
	"payload" jsonb,
	"first_triggered_at" timestamp with time zone NOT NULL DEFAULT now(),
	"last_triggered_at" timestamp with time zone NOT NULL DEFAULT now(),
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by_user_id" text,
	"resolved_at" timestamp with time zone,
	"resolved_by_user_id" text,
	"discord_delivery_status" "tax_alert_discord_delivery_status" NOT NULL DEFAULT 'pending',
	"discord_attempt_count" integer NOT NULL DEFAULT 0,
	"discord_last_attempt_at" timestamp with time zone,
	"discord_last_error" text,
	"next_retry_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL DEFAULT now(),
	"updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

ALTER TABLE "tax_alerts" ADD COLUMN IF NOT EXISTS "corporation_id" text;
ALTER TABLE "tax_alerts" ADD COLUMN IF NOT EXISTS "alert_type" text;
ALTER TABLE "tax_alerts" ADD COLUMN IF NOT EXISTS "severity" "tax_alert_severity";
ALTER TABLE "tax_alerts" ADD COLUMN IF NOT EXISTS "status" "tax_alert_status";
ALTER TABLE "tax_alerts" ADD COLUMN IF NOT EXISTS "dedupe_key" text;
ALTER TABLE "tax_alerts" ADD COLUMN IF NOT EXISTS "payload" jsonb;
ALTER TABLE "tax_alerts" ADD COLUMN IF NOT EXISTS "first_triggered_at" timestamp with time zone;
ALTER TABLE "tax_alerts" ADD COLUMN IF NOT EXISTS "last_triggered_at" timestamp with time zone;
ALTER TABLE "tax_alerts" ADD COLUMN IF NOT EXISTS "acknowledged_at" timestamp with time zone;
ALTER TABLE "tax_alerts" ADD COLUMN IF NOT EXISTS "acknowledged_by_user_id" text;
ALTER TABLE "tax_alerts" ADD COLUMN IF NOT EXISTS "resolved_at" timestamp with time zone;
ALTER TABLE "tax_alerts" ADD COLUMN IF NOT EXISTS "resolved_by_user_id" text;
ALTER TABLE "tax_alerts" ADD COLUMN IF NOT EXISTS "discord_delivery_status" "tax_alert_discord_delivery_status";
ALTER TABLE "tax_alerts" ADD COLUMN IF NOT EXISTS "discord_attempt_count" integer;
ALTER TABLE "tax_alerts" ADD COLUMN IF NOT EXISTS "discord_last_attempt_at" timestamp with time zone;
ALTER TABLE "tax_alerts" ADD COLUMN IF NOT EXISTS "discord_last_error" text;
ALTER TABLE "tax_alerts" ADD COLUMN IF NOT EXISTS "next_retry_at" timestamp with time zone;
ALTER TABLE "tax_alerts" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone;
ALTER TABLE "tax_alerts" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone;
--> statement-breakpoint

DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM information_schema.columns
		WHERE table_schema = 'public'
			AND table_name = 'tax_alerts'
			AND column_name = 'severity'
			AND udt_name <> 'tax_alert_severity'
	) THEN
		ALTER TABLE "tax_alerts"
		ALTER COLUMN "severity" TYPE "tax_alert_severity"
		USING CASE
			WHEN "severity" IN ('critical', 'warning', 'info') THEN "severity"::"tax_alert_severity"
			ELSE 'info'::"tax_alert_severity"
		END;
	END IF;
END $$;
--> statement-breakpoint

DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM information_schema.columns
		WHERE table_schema = 'public'
			AND table_name = 'tax_alerts'
			AND column_name = 'status'
			AND udt_name <> 'tax_alert_status'
	) THEN
		ALTER TABLE "tax_alerts"
		ALTER COLUMN "status" TYPE "tax_alert_status"
		USING CASE
			WHEN "status" IN ('open', 'acknowledged', 'resolved') THEN "status"::"tax_alert_status"
			ELSE 'open'::"tax_alert_status"
		END;
	END IF;
END $$;
--> statement-breakpoint

DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM information_schema.columns
		WHERE table_schema = 'public'
			AND table_name = 'tax_alerts'
			AND column_name = 'discord_delivery_status'
			AND udt_name <> 'tax_alert_discord_delivery_status'
	) THEN
		ALTER TABLE "tax_alerts"
		ALTER COLUMN "discord_delivery_status" TYPE "tax_alert_discord_delivery_status"
		USING CASE
			WHEN "discord_delivery_status" IN ('pending', 'sent', 'failed', 'skipped')
				THEN "discord_delivery_status"::"tax_alert_discord_delivery_status"
			ELSE 'pending'::"tax_alert_discord_delivery_status"
		END;
	END IF;
END $$;
--> statement-breakpoint

UPDATE "tax_alerts"
SET
	"severity" = COALESCE("severity", 'info'::"tax_alert_severity"),
	"status" = COALESCE("status", 'open'::"tax_alert_status"),
	"alert_type" = COALESCE(NULLIF("alert_type", ''), 'unknown'),
	"dedupe_key" = COALESCE(NULLIF("dedupe_key", ''), 'legacy:' || "id"::text),
	"first_triggered_at" = COALESCE("first_triggered_at", now()),
	"last_triggered_at" = COALESCE("last_triggered_at", now()),
	"discord_delivery_status" = COALESCE(
		"discord_delivery_status",
		'pending'::"tax_alert_discord_delivery_status"
	),
	"discord_attempt_count" = COALESCE("discord_attempt_count", 0),
	"created_at" = COALESCE("created_at", now()),
	"updated_at" = COALESCE("updated_at", now())
WHERE
	"severity" IS NULL
	OR "status" IS NULL
	OR "alert_type" IS NULL
	OR "alert_type" = ''
	OR "dedupe_key" IS NULL
	OR "dedupe_key" = ''
	OR "first_triggered_at" IS NULL
	OR "last_triggered_at" IS NULL
	OR "discord_delivery_status" IS NULL
	OR "discord_attempt_count" IS NULL
	OR "created_at" IS NULL
	OR "updated_at" IS NULL;
--> statement-breakpoint

ALTER TABLE "tax_alerts" ALTER COLUMN "alert_type" SET NOT NULL;
ALTER TABLE "tax_alerts" ALTER COLUMN "severity" SET NOT NULL;
ALTER TABLE "tax_alerts" ALTER COLUMN "status" SET NOT NULL;
ALTER TABLE "tax_alerts" ALTER COLUMN "dedupe_key" SET NOT NULL;
ALTER TABLE "tax_alerts" ALTER COLUMN "first_triggered_at" SET NOT NULL;
ALTER TABLE "tax_alerts" ALTER COLUMN "last_triggered_at" SET NOT NULL;
ALTER TABLE "tax_alerts" ALTER COLUMN "discord_delivery_status" SET NOT NULL;
ALTER TABLE "tax_alerts" ALTER COLUMN "discord_attempt_count" SET NOT NULL;
ALTER TABLE "tax_alerts" ALTER COLUMN "created_at" SET NOT NULL;
ALTER TABLE "tax_alerts" ALTER COLUMN "updated_at" SET NOT NULL;
--> statement-breakpoint

ALTER TABLE "tax_alerts" ALTER COLUMN "severity" SET DEFAULT 'info'::"tax_alert_severity";
ALTER TABLE "tax_alerts" ALTER COLUMN "status" SET DEFAULT 'open'::"tax_alert_status";
ALTER TABLE "tax_alerts"
ALTER COLUMN "discord_delivery_status"
SET DEFAULT 'pending'::"tax_alert_discord_delivery_status";
ALTER TABLE "tax_alerts" ALTER COLUMN "discord_attempt_count" SET DEFAULT 0;
ALTER TABLE "tax_alerts" ALTER COLUMN "first_triggered_at" SET DEFAULT now();
ALTER TABLE "tax_alerts" ALTER COLUMN "last_triggered_at" SET DEFAULT now();
ALTER TABLE "tax_alerts" ALTER COLUMN "created_at" SET DEFAULT now();
ALTER TABLE "tax_alerts" ALTER COLUMN "updated_at" SET DEFAULT now();
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "tax_alerts_dedupe_key_unique"
	ON "tax_alerts" USING btree ("dedupe_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tax_alerts_corporation_id_idx"
	ON "tax_alerts" USING btree ("corporation_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tax_alerts_status_idx"
	ON "tax_alerts" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tax_alerts_severity_idx"
	ON "tax_alerts" USING btree ("severity");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tax_alerts_last_triggered_at_idx"
	ON "tax_alerts" USING btree ("last_triggered_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tax_alerts_discord_delivery_status_idx"
	ON "tax_alerts" USING btree ("discord_delivery_status");
