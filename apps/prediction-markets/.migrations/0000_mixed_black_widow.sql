CREATE TYPE "public"."pm_bet_status" AS ENUM('active', 'won', 'lost', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."pm_ledger_type" AS ENUM('grant', 'wager', 'refund', 'payout', 'rake', 'burn', 'adjustment');--> statement-breakpoint
CREATE TYPE "public"."pm_market_status" AS ENUM('draft', 'open', 'closed', 'resolving', 'resolved', 'voided');--> statement-breakpoint
CREATE TYPE "public"."pm_proposal_status" AS ENUM('pending', 'approved', 'rejected', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."pm_visibility" AS ENUM('public', 'internal');--> statement-breakpoint
CREATE TABLE "pm_bets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_id" uuid NOT NULL,
	"outcome_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"amount" numeric NOT NULL,
	"status" "pm_bet_status" DEFAULT 'active' NOT NULL,
	"payout_amount" numeric,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pm_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"default_rake_bps" integer DEFAULT 100 NOT NULL,
	"default_min_stake" numeric DEFAULT '1' NOT NULL,
	"two_of_n_threshold" numeric,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_to" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pm_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"amount" numeric NOT NULL,
	"type" "pm_ledger_type" NOT NULL,
	"market_id" uuid,
	"bet_id" uuid,
	"balance_after" numeric,
	"idempotency_key" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pm_market_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"previous_status" "pm_market_status",
	"new_status" "pm_market_status",
	"visibility" "pm_visibility" DEFAULT 'public' NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pm_market_outcomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_id" uuid NOT NULL,
	"label" text NOT NULL,
	"pool_amount" numeric DEFAULT '0' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pm_markets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question" text NOT NULL,
	"description" text,
	"status" "pm_market_status" DEFAULT 'draft' NOT NULL,
	"created_by" uuid NOT NULL,
	"closes_at" timestamp with time zone NOT NULL,
	"resolved_outcome_id" uuid,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"void_reason" text,
	"total_pool" numeric DEFAULT '0' NOT NULL,
	"rake_bps" integer DEFAULT 0 NOT NULL,
	"min_stake" numeric DEFAULT '1' NOT NULL,
	"max_stake" numeric,
	"per_user_cap" numeric,
	"two_of_n" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pm_resolution_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_id" uuid NOT NULL,
	"outcome_id" uuid,
	"proposed_by" uuid NOT NULL,
	"approved_by" uuid,
	"status" "pm_proposal_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pm_wallets" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"balance" numeric DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "pm_bets_idempotency_key_uq" ON "pm_bets" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "pm_bets_market_user_idx" ON "pm_bets" USING btree ("market_id","user_id");--> statement-breakpoint
CREATE INDEX "pm_bets_user_created_idx" ON "pm_bets" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "pm_bets_market_outcome_idx" ON "pm_bets" USING btree ("market_id","outcome_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pm_ledger_bet_type_uq" ON "pm_ledger" USING btree ("bet_id","type");--> statement-breakpoint
CREATE UNIQUE INDEX "pm_ledger_idempotency_key_uq" ON "pm_ledger" USING btree ("idempotency_key") WHERE "pm_ledger"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "pm_ledger_user_created_idx" ON "pm_ledger" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "pm_ledger_market_idx" ON "pm_ledger" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "pm_market_history_market_created_idx" ON "pm_market_history" USING btree ("market_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pm_market_outcomes_market_label_uq" ON "pm_market_outcomes" USING btree ("market_id","label");--> statement-breakpoint
CREATE INDEX "pm_market_outcomes_market_idx" ON "pm_market_outcomes" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "pm_markets_status_closes_idx" ON "pm_markets" USING btree ("status","closes_at");--> statement-breakpoint
CREATE INDEX "pm_resolution_proposals_market_status_idx" ON "pm_resolution_proposals" USING btree ("market_id","status");