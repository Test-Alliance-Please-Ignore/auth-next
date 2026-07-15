CREATE TYPE "public"."lmsr_market_status" AS ENUM('draft', 'open', 'closed', 'resolving', 'resolved', 'voided');--> statement-breakpoint
CREATE TYPE "public"."lmsr_trade_side" AS ENUM('buy', 'sell');--> statement-breakpoint
CREATE TABLE "lmsr_market_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"previous_status" "lmsr_market_status",
	"new_status" "lmsr_market_status",
	"visibility" "pm_visibility" DEFAULT 'public' NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lmsr_markets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question" text NOT NULL,
	"description" text,
	"status" "lmsr_market_status" DEFAULT 'draft' NOT NULL,
	"created_by" uuid NOT NULL,
	"closes_at" timestamp with time zone NOT NULL,
	"resolves_on" timestamp with time zone,
	"liquidity_param" numeric NOT NULL,
	"outcome_count" integer NOT NULL,
	"subsidy" numeric NOT NULL,
	"resolved_outcome_id" uuid,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"void_reason" text,
	"designated_resolvers" uuid[],
	"discord_thread_id" text,
	"discord_message_id" text,
	"settlement_announced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lmsr_outcomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_id" uuid NOT NULL,
	"label" text NOT NULL,
	"net_shares" numeric DEFAULT '0' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lmsr_positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"outcome_id" uuid NOT NULL,
	"shares" numeric DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lmsr_trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"outcome_id" uuid NOT NULL,
	"side" "lmsr_trade_side" NOT NULL,
	"shares" numeric NOT NULL,
	"cost_points" numeric NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "lmsr_market_history_market_created_idx" ON "lmsr_market_history" USING btree ("market_id","created_at");--> statement-breakpoint
CREATE INDEX "lmsr_market_history_created_id_idx" ON "lmsr_market_history" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "lmsr_markets_status_closes_idx" ON "lmsr_markets" USING btree ("status","closes_at");--> statement-breakpoint
CREATE UNIQUE INDEX "lmsr_markets_thread_uq" ON "lmsr_markets" USING btree ("discord_thread_id");--> statement-breakpoint
CREATE INDEX "lmsr_markets_settle_unannounced_idx" ON "lmsr_markets" USING btree ("updated_at") WHERE "lmsr_markets"."settlement_announced_at" is null and "lmsr_markets"."status" in ('resolved', 'voided');--> statement-breakpoint
CREATE UNIQUE INDEX "lmsr_outcomes_market_label_uq" ON "lmsr_outcomes" USING btree ("market_id","label");--> statement-breakpoint
CREATE INDEX "lmsr_outcomes_market_idx" ON "lmsr_outcomes" USING btree ("market_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lmsr_positions_market_user_outcome_uq" ON "lmsr_positions" USING btree ("market_id","user_id","outcome_id");--> statement-breakpoint
CREATE INDEX "lmsr_positions_market_outcome_idx" ON "lmsr_positions" USING btree ("market_id","outcome_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lmsr_trades_idempotency_key_uq" ON "lmsr_trades" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "lmsr_trades_market_user_idx" ON "lmsr_trades" USING btree ("market_id","user_id");--> statement-breakpoint
CREATE INDEX "lmsr_trades_user_created_idx" ON "lmsr_trades" USING btree ("user_id","created_at");