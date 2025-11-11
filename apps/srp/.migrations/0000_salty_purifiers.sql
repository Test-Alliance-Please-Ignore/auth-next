CREATE TYPE "public"."srp_comment_visibility" AS ENUM('public', 'internal');--> statement-breakpoint
CREATE TYPE "public"."srp_payment_status" AS ENUM('n/a', 'pending', 'paid_in_full', 'partial_payment');--> statement-breakpoint
CREATE TYPE "public"."srp_request_status" AS ENUM('pending', 'in_review', 'approved', 'partially_approved', 'rejected');--> statement-breakpoint
CREATE TABLE "srp_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"author_user_id" uuid NOT NULL,
	"author_character_name" varchar(255) NOT NULL,
	"content" text NOT NULL,
	"visibility" "srp_comment_visibility" DEFAULT 'public' NOT NULL,
	"is_edited" boolean DEFAULT false NOT NULL,
	"edited_at" timestamp with time zone,
	"original_content" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "srp_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"default_coverage_rate" text DEFAULT '1.0' NOT NULL,
	"max_payout_amount" text,
	"min_ship_value" text DEFAULT '0' NOT NULL,
	"auto_approval_enabled" boolean DEFAULT false NOT NULL,
	"auto_approval_threshold" text,
	"eligible_corporation_ids" text[],
	"rejection_reasons" jsonb DEFAULT '[]'::jsonb,
	"metadata" jsonb,
	"created_by" uuid NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "srp_request_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"actor_character_name" varchar(255) NOT NULL,
	"action" varchar(100) NOT NULL,
	"previous_request_status" "srp_request_status",
	"new_request_status" "srp_request_status",
	"previous_payment_status" "srp_payment_status",
	"new_payment_status" "srp_payment_status",
	"previous_approved_amount" text,
	"new_approved_amount" text,
	"metadata" jsonb,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "srp_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"character_id" text NOT NULL,
	"character_name" varchar(255) NOT NULL,
	"corporation_id" text NOT NULL,
	"corporation_name" varchar(255) NOT NULL,
	"killmail_id" text NOT NULL,
	"killmail_hash" varchar(255) NOT NULL,
	"ship_type_id" text NOT NULL,
	"ship_type_name" varchar(255) NOT NULL,
	"ship_value" text NOT NULL,
	"requested_amount" text,
	"approved_amount" text,
	"request_status" "srp_request_status" DEFAULT 'pending' NOT NULL,
	"payment_status" "srp_payment_status" DEFAULT 'n/a' NOT NULL,
	"payment_token" varchar(16) NOT NULL,
	"payment_date" timestamp with time zone,
	"payment_character_name" varchar(255),
	"reviewer_id" uuid,
	"reviewer_character_name" varchar(255),
	"reviewed_at" timestamp with time zone,
	"review_notes" text,
	"killmail_data" jsonb,
	"loss_date" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "srp_requests_killmail_id_unique" UNIQUE("killmail_id"),
	CONSTRAINT "srp_requests_payment_token_unique" UNIQUE("payment_token")
);
--> statement-breakpoint
ALTER TABLE "srp_comments" ADD CONSTRAINT "srp_comments_request_id_srp_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."srp_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "srp_request_history" ADD CONSTRAINT "srp_request_history_request_id_srp_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."srp_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "srp_comments_request_id_idx" ON "srp_comments" USING btree ("request_id","created_at");--> statement-breakpoint
CREATE INDEX "srp_comments_author_user_id_idx" ON "srp_comments" USING btree ("author_user_id");--> statement-breakpoint
CREATE INDEX "srp_comments_request_visibility_idx" ON "srp_comments" USING btree ("request_id","visibility");--> statement-breakpoint
CREATE INDEX "srp_config_active_idx" ON "srp_config" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "srp_config_effective_from_idx" ON "srp_config" USING btree ("effective_from");--> statement-breakpoint
CREATE INDEX "srp_request_history_request_id_idx" ON "srp_request_history" USING btree ("request_id","timestamp" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "srp_request_history_actor_user_id_idx" ON "srp_request_history" USING btree ("actor_user_id","timestamp" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "srp_request_history_timestamp_idx" ON "srp_request_history" USING btree ("timestamp" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "srp_request_history_action_idx" ON "srp_request_history" USING btree ("action");--> statement-breakpoint
CREATE INDEX "srp_requests_user_id_idx" ON "srp_requests" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "srp_requests_character_id_idx" ON "srp_requests" USING btree ("character_id");--> statement-breakpoint
CREATE INDEX "srp_requests_corporation_id_idx" ON "srp_requests" USING btree ("corporation_id");--> statement-breakpoint
CREATE INDEX "srp_requests_request_status_idx" ON "srp_requests" USING btree ("request_status");--> statement-breakpoint
CREATE INDEX "srp_requests_payment_status_idx" ON "srp_requests" USING btree ("payment_status");--> statement-breakpoint
CREATE INDEX "srp_requests_status_created_idx" ON "srp_requests" USING btree ("request_status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "srp_requests_payment_token_idx" ON "srp_requests" USING btree ("payment_token");--> statement-breakpoint
CREATE INDEX "srp_requests_killmail_id_idx" ON "srp_requests" USING btree ("killmail_id");--> statement-breakpoint
CREATE INDEX "srp_requests_loss_date_idx" ON "srp_requests" USING btree ("loss_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "srp_requests_created_at_idx" ON "srp_requests" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "srp_requests_reviewer_id_idx" ON "srp_requests" USING btree ("reviewer_id");