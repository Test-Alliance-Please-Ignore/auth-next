CREATE TYPE "public"."bill_status" AS ENUM('draft', 'issued', 'paid', 'cancelled', 'overdue');--> statement-breakpoint
CREATE TYPE "public"."entity_type" AS ENUM('character', 'corporation', 'group');--> statement-breakpoint
CREATE TYPE "public"."late_fee_compounding" AS ENUM('none', 'daily', 'weekly', 'monthly');--> statement-breakpoint
CREATE TYPE "public"."late_fee_type" AS ENUM('none', 'static', 'percentage');--> statement-breakpoint
CREATE TYPE "public"."schedule_frequency" AS ENUM('daily', 'weekly', 'monthly');--> statement-breakpoint
CREATE TABLE "bill_schedules" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"template_id" text NOT NULL,
	"payer_id" text NOT NULL,
	"payer_type" "entity_type" NOT NULL,
	"frequency" "schedule_frequency" NOT NULL,
	"amount" text NOT NULL,
	"next_generation_time" timestamp NOT NULL,
	"last_generation_time" timestamp,
	"is_active" boolean DEFAULT true NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bill_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"amount_template" text DEFAULT '{amount}' NOT NULL,
	"title_template" text NOT NULL,
	"description_template" text,
	"late_fee_type" "late_fee_type" DEFAULT 'none' NOT NULL,
	"late_fee_amount" text DEFAULT '0' NOT NULL,
	"late_fee_compounding" "late_fee_compounding" DEFAULT 'none' NOT NULL,
	"days_until_due" integer DEFAULT 30 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bills" (
	"id" text PRIMARY KEY NOT NULL,
	"issuer_id" text NOT NULL,
	"payer_id" text NOT NULL,
	"payer_type" "entity_type" NOT NULL,
	"template_id" text,
	"schedule_id" text,
	"title" text NOT NULL,
	"description" text,
	"amount" text NOT NULL,
	"late_fee" text DEFAULT '0' NOT NULL,
	"late_fee_type" "late_fee_type" DEFAULT 'none' NOT NULL,
	"late_fee_amount" text DEFAULT '0' NOT NULL,
	"late_fee_compounding" "late_fee_compounding" DEFAULT 'none' NOT NULL,
	"due_date" timestamp NOT NULL,
	"status" "bill_status" DEFAULT 'draft' NOT NULL,
	"paid_at" timestamp,
	"payment_token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "bills_payment_token_unique" UNIQUE("payment_token")
);
--> statement-breakpoint
CREATE TABLE "schedule_execution_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"schedule_id" text NOT NULL,
	"generated_bill_id" text,
	"executed_at" timestamp DEFAULT now() NOT NULL,
	"success" boolean NOT NULL,
	"error_message" text
);
--> statement-breakpoint
ALTER TABLE "bill_schedules" ADD CONSTRAINT "bill_schedules_template_id_bill_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."bill_templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_execution_logs" ADD CONSTRAINT "schedule_execution_logs_schedule_id_bill_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."bill_schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bill_schedules_owner_id_idx" ON "bill_schedules" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "bill_schedules_template_id_idx" ON "bill_schedules" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "bill_schedules_payer_id_idx" ON "bill_schedules" USING btree ("payer_id");--> statement-breakpoint
CREATE INDEX "bill_schedules_next_generation_time_idx" ON "bill_schedules" USING btree ("next_generation_time");--> statement-breakpoint
CREATE INDEX "bill_schedules_is_active_idx" ON "bill_schedules" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "bill_templates_owner_id_idx" ON "bill_templates" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "bills_issuer_id_idx" ON "bills" USING btree ("issuer_id");--> statement-breakpoint
CREATE INDEX "bills_payer_id_idx" ON "bills" USING btree ("payer_id");--> statement-breakpoint
CREATE INDEX "bills_status_idx" ON "bills" USING btree ("status");--> statement-breakpoint
CREATE INDEX "bills_due_date_idx" ON "bills" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX "bills_template_id_idx" ON "bills" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "bills_schedule_id_idx" ON "bills" USING btree ("schedule_id");--> statement-breakpoint
CREATE INDEX "bills_payment_token_idx" ON "bills" USING btree ("payment_token");--> statement-breakpoint
CREATE INDEX "schedule_execution_logs_schedule_id_idx" ON "schedule_execution_logs" USING btree ("schedule_id");--> statement-breakpoint
CREATE INDEX "schedule_execution_logs_executed_at_idx" ON "schedule_execution_logs" USING btree ("executed_at");