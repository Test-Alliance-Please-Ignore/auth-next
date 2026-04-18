-- Idempotent migration — safe to re-run after partial failures.
-- Uses DO blocks with exception handling throughout.

-- 1. srp_policy_effect: may already exist from a partial previous run
DO $$ BEGIN
  CREATE TYPE "public"."srp_policy_effect" AS ENUM('payout_modifier', 'cap');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

-- 2. srp_policies table
CREATE TABLE IF NOT EXISTS "srp_policies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "effect" "srp_policy_effect" NOT NULL,
  "config" jsonb NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "display_order" integer DEFAULT 0 NOT NULL,
  "created_by" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

-- 3. Rebuild srp_request_status with the 5 new values.
-- Only runs if needs_context is not yet present in the enum.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'srp_request_status' AND e.enumlabel = 'needs_context'
  ) THEN
    ALTER TABLE "srp_request_history" ALTER COLUMN "previous_request_status" SET DATA TYPE text;
    ALTER TABLE "srp_request_history" ALTER COLUMN "new_request_status" SET DATA TYPE text;
    ALTER TABLE "srp_requests" ALTER COLUMN "request_status" SET DATA TYPE text;
    ALTER TABLE "srp_requests" ALTER COLUMN "request_status" SET DEFAULT 'pending'::text;
    UPDATE "srp_requests" SET "request_status" = 'pending'
      WHERE "request_status" IN ('in_review', 'partially_approved');
    DROP TYPE "public"."srp_request_status";
    CREATE TYPE "public"."srp_request_status" AS ENUM('pending', 'needs_context', 'approved', 'rejected', 'paid');
    ALTER TABLE "srp_request_history" ALTER COLUMN "previous_request_status"
      SET DATA TYPE "public"."srp_request_status"
      USING "previous_request_status"::"public"."srp_request_status";
    ALTER TABLE "srp_request_history" ALTER COLUMN "new_request_status"
      SET DATA TYPE "public"."srp_request_status"
      USING "new_request_status"::"public"."srp_request_status";
    ALTER TABLE "srp_requests" ALTER COLUMN "request_status"
      SET DEFAULT 'pending'::"public"."srp_request_status";
    ALTER TABLE "srp_requests" ALTER COLUMN "request_status"
      SET DATA TYPE "public"."srp_request_status"
      USING "request_status"::"public"."srp_request_status";
  END IF;
END $$;--> statement-breakpoint

-- 4. Drop the old payment_status index (may already be gone)
DROP INDEX IF EXISTS "srp_requests_payment_status_idx";--> statement-breakpoint

-- 5. Drop payment_status column from srp_requests if still present
--    (may have been renamed to srp_equipment_value by a partial run)
DO $$ BEGIN
  ALTER TABLE "srp_requests" DROP COLUMN "payment_status";
EXCEPTION WHEN undefined_column THEN NULL;
END $$;--> statement-breakpoint

-- 6. Drop previous_payment_status from srp_request_history if still present
--    (may have been renamed to visibility by a partial run)
DO $$ BEGIN
  ALTER TABLE "srp_request_history" DROP COLUMN "previous_payment_status";
EXCEPTION WHEN undefined_column THEN NULL;
END $$;--> statement-breakpoint

-- 7. Drop new_payment_status from srp_request_history if still present
DO $$ BEGIN
  ALTER TABLE "srp_request_history" DROP COLUMN "new_payment_status";
EXCEPTION WHEN undefined_column THEN NULL;
END $$;--> statement-breakpoint

-- 8. Drop srp_payment_status type if still present
--    (may have been renamed away by a partial run)
DO $$ BEGIN
  DROP TYPE "public"."srp_payment_status";
EXCEPTION WHEN undefined_object THEN NULL;
END $$;--> statement-breakpoint

-- 9. Handle visibility column on srp_request_history.
--    Three possible states after partial runs:
--    a) Doesn't exist yet → ADD COLUMN
--    b) Exists with wrong type (srp_policy_effect, renamed from previous_payment_status) → fix type
--    c) Exists with correct type (srp_comment_visibility) → nothing to do
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'srp_request_history'
      AND column_name = 'visibility'
      AND udt_name != 'srp_comment_visibility'
  ) THEN
    ALTER TABLE "srp_request_history" ALTER COLUMN "visibility" DROP DEFAULT;
    ALTER TABLE "srp_request_history" ALTER COLUMN "visibility" DROP NOT NULL;
    ALTER TABLE "srp_request_history" ALTER COLUMN "visibility"
      TYPE "public"."srp_comment_visibility"
      USING 'public'::"public"."srp_comment_visibility";
    ALTER TABLE "srp_request_history" ALTER COLUMN "visibility" SET DEFAULT 'public';
    ALTER TABLE "srp_request_history" ALTER COLUMN "visibility" SET NOT NULL;
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'srp_request_history'
      AND column_name = 'visibility'
  ) THEN
    ALTER TABLE "srp_request_history"
      ADD COLUMN "visibility" "public"."srp_comment_visibility" DEFAULT 'public' NOT NULL;
  END IF;
END $$;--> statement-breakpoint

-- 10. max_loss_age_days on srp_config
DO $$ BEGIN
  ALTER TABLE "srp_config" ADD COLUMN "max_loss_age_days" integer DEFAULT 60 NOT NULL;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;--> statement-breakpoint

-- 11. New valuation + review columns on srp_requests (all idempotent)
DO $$ BEGIN ALTER TABLE "srp_requests" ADD COLUMN "srp_equipment_value" text; EXCEPTION WHEN duplicate_column THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "srp_requests" ADD COLUMN "srp_insurance_premium" text; EXCEPTION WHEN duplicate_column THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "srp_requests" ADD COLUMN "srp_insurance_payout" text; EXCEPTION WHEN duplicate_column THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "srp_requests" ADD COLUMN "srp_net_insurance" text; EXCEPTION WHEN duplicate_column THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "srp_requests" ADD COLUMN "srp_calculated_value" text; EXCEPTION WHEN duplicate_column THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "srp_requests" ADD COLUMN "srp_final_value" text; EXCEPTION WHEN duplicate_column THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "srp_requests" ADD COLUMN "srp_price_snapshot_time" timestamp with time zone; EXCEPTION WHEN duplicate_column THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "srp_requests" ADD COLUMN "srp_item_prices" jsonb; EXCEPTION WHEN duplicate_column THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "srp_requests" ADD COLUMN "applied_modifier_policy_id" uuid; EXCEPTION WHEN duplicate_column THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "srp_requests" ADD COLUMN "applied_modifier_policy_name" text; EXCEPTION WHEN duplicate_column THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "srp_requests" ADD COLUMN "applied_cap_policy_id" uuid; EXCEPTION WHEN duplicate_column THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "srp_requests" ADD COLUMN "applied_cap_policy_name" text; EXCEPTION WHEN duplicate_column THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "srp_requests" ADD COLUMN "applied_modifiers" jsonb; EXCEPTION WHEN duplicate_column THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "srp_requests" ADD COLUMN "reviewer_override_millions" integer; EXCEPTION WHEN duplicate_column THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "srp_requests" ADD COLUMN "fleet_id" text; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
