CREATE TABLE "dkp_decay_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"decay_model" text NOT NULL,
	"decay_rate" text,
	"decay_period_days" integer,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"description" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dkp_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"character_id" text NOT NULL,
	"character_name" varchar(255) NOT NULL,
	"corporation_id" text NOT NULL,
	"corporation_name" varchar(255) NOT NULL,
	"amount" integer NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text,
	"source_metadata" jsonb,
	"awarded_by" uuid,
	"award_reason" text,
	"decay_model" text DEFAULT 'none' NOT NULL,
	"decay_rate" text,
	"decay_period_days" integer,
	"earned_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dkp_decay_config" ADD CONSTRAINT "dkp_decay_config_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dkp_transactions" ADD CONSTRAINT "dkp_transactions_awarded_by_users_id_fk" FOREIGN KEY ("awarded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dkp_decay_config_active_idx" ON "dkp_decay_config" USING btree ("is_active") WHERE "dkp_decay_config"."is_active" = true;--> statement-breakpoint
CREATE INDEX "dkp_decay_config_effective_from_idx" ON "dkp_decay_config" USING btree ("effective_from");--> statement-breakpoint
CREATE INDEX "dkp_transactions_character_earned_idx" ON "dkp_transactions" USING btree ("character_id","earned_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "dkp_transactions_corp_earned_idx" ON "dkp_transactions" USING btree ("corporation_id","earned_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "dkp_transactions_earned_at_idx" ON "dkp_transactions" USING btree ("earned_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "dkp_transactions_source_type_idx" ON "dkp_transactions" USING btree ("source_type");--> statement-breakpoint
CREATE INDEX "dkp_transactions_source_id_idx" ON "dkp_transactions" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "dkp_transactions_awarded_by_idx" ON "dkp_transactions" USING btree ("awarded_by");