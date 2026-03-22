CREATE TYPE "public"."tax_alert_discord_delivery_status" AS ENUM('pending', 'sent', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."tax_alert_severity" AS ENUM('critical', 'warning', 'info');--> statement-breakpoint
CREATE TYPE "public"."tax_alert_status" AS ENUM('open', 'acknowledged', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."tax_assessment_scope" AS ENUM('corporation', 'division', 'character');--> statement-breakpoint
CREATE TYPE "public"."tax_assessment_status" AS ENUM('draft', 'underpaid', 'paid', 'overpaid', 'excluded');--> statement-breakpoint
CREATE TYPE "public"."tax_bill_status" AS ENUM('draft', 'issued', 'paid', 'cancelled', 'overdue');--> statement-breakpoint
CREATE TYPE "public"."tax_export_format" AS ENUM('csv', 'xlsx');--> statement-breakpoint
CREATE TYPE "public"."tax_export_frequency" AS ENUM('weekly', 'monthly');--> statement-breakpoint
CREATE TYPE "public"."tax_export_status" AS ENUM('queued', 'running', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."tax_period_status" AS ENUM('open', 'assessed', 'closed');--> statement-breakpoint
CREATE TABLE "managed_corporations" (
	"corporation_id" text PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_member_corporation" boolean DEFAULT false NOT NULL,
	"is_special_purpose" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"corporation_id" text,
	"alert_type" text NOT NULL,
	"severity" "tax_alert_severity" NOT NULL,
	"status" "tax_alert_status" DEFAULT 'open' NOT NULL,
	"dedupe_key" text NOT NULL,
	"payload" jsonb,
	"first_triggered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_triggered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by_user_id" text,
	"resolved_at" timestamp with time zone,
	"resolved_by_user_id" text,
	"discord_delivery_status" "tax_alert_discord_delivery_status" DEFAULT 'pending' NOT NULL,
	"discord_attempt_count" integer DEFAULT 0 NOT NULL,
	"discord_last_attempt_at" timestamp with time zone,
	"discord_last_error" text,
	"next_retry_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_alerts_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "tax_assessment_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assessment_id" uuid NOT NULL,
	"ledger_entry_id" uuid NOT NULL,
	"applied_rule_set_id" uuid,
	"tax_rate_bps" integer DEFAULT 0 NOT NULL,
	"taxable_amount" text DEFAULT '0' NOT NULL,
	"tax_amount" text DEFAULT '0' NOT NULL,
	"classification" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_assessment_lines_assessment_ledger_unique" UNIQUE("assessment_id","ledger_entry_id")
);
--> statement-breakpoint
CREATE TABLE "tax_assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"corporation_id" text NOT NULL,
	"tax_period_start" timestamp with time zone NOT NULL,
	"tax_period_end" timestamp with time zone NOT NULL,
	"assessment_scope" "tax_assessment_scope" DEFAULT 'corporation' NOT NULL,
	"scope_id" text NOT NULL,
	"taxable_income" text DEFAULT '0' NOT NULL,
	"non_taxable_income" text DEFAULT '0' NOT NULL,
	"tax_due" text DEFAULT '0' NOT NULL,
	"tax_paid" text DEFAULT '0' NOT NULL,
	"tax_delta" text DEFAULT '0' NOT NULL,
	"status" "tax_assessment_status" DEFAULT 'draft' NOT NULL,
	"in_game_tax_rate_bps" integer,
	"portal_tax_rate_bps" integer DEFAULT 0 NOT NULL,
	"bill_id" uuid,
	"bill_status" "tax_bill_status",
	"bill_status_last_synced_at" timestamp with time zone,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_assessments_scope_period_unique" UNIQUE("corporation_id","tax_period_start","tax_period_end","assessment_scope","scope_id")
);
--> statement-breakpoint
CREATE TABLE "tax_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"corporation_id" text,
	"actor_user_id" text NOT NULL,
	"action" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_bill_sync_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"corporation_id" text NOT NULL,
	"assessment_id" uuid NOT NULL,
	"bill_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"from_status" text,
	"to_status" text,
	"payload" jsonb,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_corporation_billing_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"corporation_id" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"billing_enabled" boolean DEFAULT false NOT NULL,
	"billing_issuer_user_id" text DEFAULT '' NOT NULL,
	"billing_payee_id" text DEFAULT '' NOT NULL,
	"billing_payee_type" text DEFAULT '' NOT NULL,
	"billing_due_days" integer DEFAULT 14 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_corporation_billing_configs_payee_tuple_unique" UNIQUE("corporation_id","billing_payee_type","billing_payee_id")
);
--> statement-breakpoint
CREATE TABLE "tax_corporation_exclusions" (
	"corporation_id" text PRIMARY KEY NOT NULL,
	"reason" text,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_daily_rollups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"corporation_id" text NOT NULL,
	"rollup_date" date NOT NULL,
	"division" integer,
	"ref_type" text,
	"taxable_income" text DEFAULT '0' NOT NULL,
	"tax_due" text DEFAULT '0' NOT NULL,
	"tax_paid" text DEFAULT '0' NOT NULL,
	"ess_income" text DEFAULT '0' NOT NULL,
	"entry_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_daily_rollups_corp_date_division_ref_unique" UNIQUE("corporation_id","rollup_date","division","ref_type")
);
--> statement-breakpoint
CREATE TABLE "tax_discrepancies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"corporation_id" text NOT NULL,
	"assessment_id" uuid,
	"discrepancy_type" text NOT NULL,
	"severity" text NOT NULL,
	"details" jsonb,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_export_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"corporation_id" text,
	"created_by_user_id" text NOT NULL,
	"format" "tax_export_format" NOT NULL,
	"frequency" "tax_export_frequency" NOT NULL,
	"report_type" text NOT NULL,
	"filters" jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"next_run_at" timestamp with time zone NOT NULL,
	"last_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"corporation_id" text,
	"requested_by_user_id" text NOT NULL,
	"format" "tax_export_format" NOT NULL,
	"report_type" text NOT NULL,
	"status" "tax_export_status" DEFAULT 'queued' NOT NULL,
	"filters" jsonb,
	"row_count" integer,
	"source_esi_version" text,
	"error" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"corporation_id" text NOT NULL,
	"source_type" text NOT NULL,
	"source_primary_id" text NOT NULL,
	"source_secondary_id" text,
	"source_key" text NOT NULL,
	"division" integer,
	"ref_type" text NOT NULL,
	"amount" text NOT NULL,
	"balance" text,
	"direction" text NOT NULL,
	"first_party_id" text,
	"second_party_id" text,
	"entry_date" timestamp with time zone NOT NULL,
	"is_ess" boolean DEFAULT false NOT NULL,
	"ess_bank_type" text,
	"raw_payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_ledger_entries_source_key_unique" UNIQUE("source_key")
);
--> statement-breakpoint
CREATE TABLE "tax_member_contribution_finalized_rollups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"corporation_id" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"rollup_date" date NOT NULL,
	"character_id" text NOT NULL,
	"ref_type" text NOT NULL,
	"contribution_income" text DEFAULT '0' NOT NULL,
	"taxable_contribution_income" text DEFAULT '0' NOT NULL,
	"assessment_count" integer DEFAULT 0 NOT NULL,
	"source_row_count" integer DEFAULT 0 NOT NULL,
	"finalized_assessment_id" uuid,
	"last_assessment_at" timestamp with time zone,
	"last_ledger_entry_date" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_member_final_rollups_unique" UNIQUE("corporation_id","period_start","period_end","rollup_date","character_id","ref_type")
);
--> statement-breakpoint
CREATE TABLE "tax_member_contribution_projection_rollups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"corporation_id" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"rollup_date" date NOT NULL,
	"character_id" text NOT NULL,
	"ref_type" text NOT NULL,
	"contribution_income" text DEFAULT '0' NOT NULL,
	"taxable_contribution_income" text DEFAULT '0' NOT NULL,
	"assessment_count" integer DEFAULT 0 NOT NULL,
	"source_row_count" integer DEFAULT 0 NOT NULL,
	"last_assessment_at" timestamp with time zone,
	"last_ledger_entry_date" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_member_proj_rollups_unique" UNIQUE("corporation_id","period_start","period_end","rollup_date","character_id","ref_type")
);
--> statement-breakpoint
CREATE TABLE "tax_member_summary_versions" (
	"corporation_id" text PRIMARY KEY NOT NULL,
	"projection_version" integer DEFAULT 0 NOT NULL,
	"finalized_version" integer DEFAULT 0 NOT NULL,
	"projection_updated_at" timestamp with time zone,
	"finalized_updated_at" timestamp with time zone,
	"rule_membership_mutated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_notification_destinations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"guild_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"updated_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"corporation_id" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"status" "tax_period_status" DEFAULT 'open' NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_periods_corp_period_unique" UNIQUE("corporation_id","period_start","period_end")
);
--> statement-breakpoint
CREATE TABLE "tax_rule_group_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_group_id" uuid NOT NULL,
	"corporation_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_rule_group_attachments_unique" UNIQUE("rule_group_id","corporation_id")
);
--> statement-breakpoint
CREATE TABLE "tax_rule_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_default_global" boolean DEFAULT false NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_rule_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_group_id" uuid NOT NULL,
	"name" text NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"applies_to_ref_type" text,
	"tax_rate_bps" integer DEFAULT 0 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_sync_checkpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"corporation_id" text NOT NULL,
	"source_type" text NOT NULL,
	"cursor" text,
	"last_seen_at" timestamp with time zone,
	"last_successful_sync_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_sync_checkpoints_corp_source_unique" UNIQUE("corporation_id","source_type")
);
--> statement-breakpoint
ALTER TABLE "tax_assessment_lines" ADD CONSTRAINT "tax_assessment_lines_assessment_id_tax_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."tax_assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_bill_sync_events" ADD CONSTRAINT "tax_bill_sync_events_assessment_id_tax_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."tax_assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_discrepancies" ADD CONSTRAINT "tax_discrepancies_assessment_id_tax_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."tax_assessments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_member_contribution_finalized_rollups" ADD CONSTRAINT "tax_member_contribution_finalized_rollups_finalized_assessment_id_tax_assessments_id_fk" FOREIGN KEY ("finalized_assessment_id") REFERENCES "public"."tax_assessments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_rule_group_attachments" ADD CONSTRAINT "tax_rule_group_attachments_rule_group_id_tax_rule_groups_id_fk" FOREIGN KEY ("rule_group_id") REFERENCES "public"."tax_rule_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_rule_sets" ADD CONSTRAINT "tax_rule_sets_rule_group_id_tax_rule_groups_id_fk" FOREIGN KEY ("rule_group_id") REFERENCES "public"."tax_rule_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "managed_corporations_is_active_idx" ON "managed_corporations" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "managed_corporations_corporation_id_is_member_idx" ON "managed_corporations" USING btree ("corporation_id","is_member_corporation");--> statement-breakpoint
CREATE INDEX "managed_corporations_corporation_id_is_special_purpose_idx" ON "managed_corporations" USING btree ("corporation_id","is_special_purpose");--> statement-breakpoint
CREATE INDEX "tax_alerts_corporation_id_idx" ON "tax_alerts" USING btree ("corporation_id");--> statement-breakpoint
CREATE INDEX "tax_alerts_status_idx" ON "tax_alerts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tax_alerts_severity_idx" ON "tax_alerts" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "tax_alerts_last_triggered_at_idx" ON "tax_alerts" USING btree ("last_triggered_at");--> statement-breakpoint
CREATE INDEX "tax_alerts_discord_delivery_status_idx" ON "tax_alerts" USING btree ("discord_delivery_status");--> statement-breakpoint
CREATE INDEX "tax_assessment_lines_assessment_id_idx" ON "tax_assessment_lines" USING btree ("assessment_id");--> statement-breakpoint
CREATE INDEX "tax_assessment_lines_ledger_entry_id_idx" ON "tax_assessment_lines" USING btree ("ledger_entry_id");--> statement-breakpoint
CREATE INDEX "tax_assessment_lines_applied_rule_set_id_idx" ON "tax_assessment_lines" USING btree ("applied_rule_set_id");--> statement-breakpoint
CREATE INDEX "tax_assessments_corporation_id_idx" ON "tax_assessments" USING btree ("corporation_id");--> statement-breakpoint
CREATE INDEX "tax_assessments_status_idx" ON "tax_assessments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tax_assessments_scope_idx" ON "tax_assessments" USING btree ("assessment_scope");--> statement-breakpoint
CREATE INDEX "tax_assessments_period_start_idx" ON "tax_assessments" USING btree ("tax_period_start");--> statement-breakpoint
CREATE INDEX "tax_assessments_period_end_idx" ON "tax_assessments" USING btree ("tax_period_end");--> statement-breakpoint
CREATE INDEX "tax_assessments_bill_id_idx" ON "tax_assessments" USING btree ("bill_id");--> statement-breakpoint
CREATE INDEX "tax_audit_log_corporation_id_idx" ON "tax_audit_log" USING btree ("corporation_id");--> statement-breakpoint
CREATE INDEX "tax_audit_log_created_at_idx" ON "tax_audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "tax_bill_sync_events_corporation_id_idx" ON "tax_bill_sync_events" USING btree ("corporation_id");--> statement-breakpoint
CREATE INDEX "tax_bill_sync_events_assessment_id_idx" ON "tax_bill_sync_events" USING btree ("assessment_id");--> statement-breakpoint
CREATE INDEX "tax_bill_sync_events_bill_id_idx" ON "tax_bill_sync_events" USING btree ("bill_id");--> statement-breakpoint
CREATE INDEX "tax_bill_sync_events_synced_at_idx" ON "tax_bill_sync_events" USING btree ("synced_at");--> statement-breakpoint
CREATE INDEX "tax_corporation_billing_configs_corporation_id_idx" ON "tax_corporation_billing_configs" USING btree ("corporation_id");--> statement-breakpoint
CREATE INDEX "tax_corporation_billing_configs_updated_at_idx" ON "tax_corporation_billing_configs" USING btree ("updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_corporation_billing_configs_one_default_per_corp" ON "tax_corporation_billing_configs" USING btree ("corporation_id") WHERE "tax_corporation_billing_configs"."is_default" = true;--> statement-breakpoint
CREATE INDEX "tax_corporation_exclusions_updated_at_idx" ON "tax_corporation_exclusions" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "tax_daily_rollups_corporation_id_idx" ON "tax_daily_rollups" USING btree ("corporation_id");--> statement-breakpoint
CREATE INDEX "tax_daily_rollups_rollup_date_idx" ON "tax_daily_rollups" USING btree ("rollup_date");--> statement-breakpoint
CREATE INDEX "tax_daily_rollups_ref_type_idx" ON "tax_daily_rollups" USING btree ("ref_type");--> statement-breakpoint
CREATE INDEX "tax_discrepancies_corporation_id_idx" ON "tax_discrepancies" USING btree ("corporation_id");--> statement-breakpoint
CREATE INDEX "tax_discrepancies_assessment_id_idx" ON "tax_discrepancies" USING btree ("assessment_id");--> statement-breakpoint
CREATE INDEX "tax_discrepancies_discrepancy_type_idx" ON "tax_discrepancies" USING btree ("discrepancy_type");--> statement-breakpoint
CREATE INDEX "tax_discrepancies_severity_idx" ON "tax_discrepancies" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "tax_export_schedules_corporation_id_idx" ON "tax_export_schedules" USING btree ("corporation_id");--> statement-breakpoint
CREATE INDEX "tax_export_schedules_created_by_idx" ON "tax_export_schedules" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "tax_export_schedules_is_active_idx" ON "tax_export_schedules" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "tax_export_schedules_next_run_at_idx" ON "tax_export_schedules" USING btree ("next_run_at");--> statement-breakpoint
CREATE INDEX "tax_exports_corporation_id_idx" ON "tax_exports" USING btree ("corporation_id");--> statement-breakpoint
CREATE INDEX "tax_exports_requested_by_idx" ON "tax_exports" USING btree ("requested_by_user_id");--> statement-breakpoint
CREATE INDEX "tax_exports_status_idx" ON "tax_exports" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tax_exports_requested_at_idx" ON "tax_exports" USING btree ("requested_at");--> statement-breakpoint
CREATE INDEX "tax_ledger_entries_corporation_id_idx" ON "tax_ledger_entries" USING btree ("corporation_id");--> statement-breakpoint
CREATE INDEX "tax_ledger_entries_ref_type_idx" ON "tax_ledger_entries" USING btree ("ref_type");--> statement-breakpoint
CREATE INDEX "tax_ledger_entries_entry_date_idx" ON "tax_ledger_entries" USING btree ("entry_date");--> statement-breakpoint
CREATE INDEX "tax_ledger_entries_is_ess_idx" ON "tax_ledger_entries" USING btree ("is_ess");--> statement-breakpoint
CREATE INDEX "tax_member_final_rollups_corp_period_idx" ON "tax_member_contribution_finalized_rollups" USING btree ("corporation_id","period_start","period_end");--> statement-breakpoint
CREATE INDEX "tax_member_final_rollups_corp_char_period_idx" ON "tax_member_contribution_finalized_rollups" USING btree ("corporation_id","character_id","period_start","period_end");--> statement-breakpoint
CREATE INDEX "tax_member_final_rollups_corp_ref_rollup_date_idx" ON "tax_member_contribution_finalized_rollups" USING btree ("corporation_id","ref_type","rollup_date");--> statement-breakpoint
CREATE INDEX "tax_member_final_rollups_assessment_id_idx" ON "tax_member_contribution_finalized_rollups" USING btree ("finalized_assessment_id");--> statement-breakpoint
CREATE INDEX "tax_member_proj_rollups_corp_period_idx" ON "tax_member_contribution_projection_rollups" USING btree ("corporation_id","period_start","period_end");--> statement-breakpoint
CREATE INDEX "tax_member_proj_rollups_corp_char_period_idx" ON "tax_member_contribution_projection_rollups" USING btree ("corporation_id","character_id","period_start","period_end");--> statement-breakpoint
CREATE INDEX "tax_member_proj_rollups_corp_ref_rollup_date_idx" ON "tax_member_contribution_projection_rollups" USING btree ("corporation_id","ref_type","rollup_date");--> statement-breakpoint
CREATE INDEX "tax_member_summary_versions_updated_at_idx" ON "tax_member_summary_versions" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "tax_notification_destinations_updated_at_idx" ON "tax_notification_destinations" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "tax_periods_corporation_id_idx" ON "tax_periods" USING btree ("corporation_id");--> statement-breakpoint
CREATE INDEX "tax_periods_period_start_idx" ON "tax_periods" USING btree ("period_start");--> statement-breakpoint
CREATE INDEX "tax_periods_period_end_idx" ON "tax_periods" USING btree ("period_end");--> statement-breakpoint
CREATE INDEX "tax_periods_status_idx" ON "tax_periods" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tax_rule_group_attachments_corporation_id_idx" ON "tax_rule_group_attachments" USING btree ("corporation_id");--> statement-breakpoint
CREATE INDEX "tax_rule_groups_default_global_idx" ON "tax_rule_groups" USING btree ("is_default_global");--> statement-breakpoint
CREATE INDEX "tax_rule_groups_name_idx" ON "tax_rule_groups" USING btree ("name");--> statement-breakpoint
CREATE INDEX "tax_rule_sets_rule_group_id_idx" ON "tax_rule_sets" USING btree ("rule_group_id");--> statement-breakpoint
CREATE INDEX "tax_rule_sets_is_active_idx" ON "tax_rule_sets" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "tax_rule_sets_priority_idx" ON "tax_rule_sets" USING btree ("priority");--> statement-breakpoint
CREATE INDEX "tax_rule_sets_ref_type_idx" ON "tax_rule_sets" USING btree ("applies_to_ref_type");--> statement-breakpoint
CREATE INDEX "tax_sync_checkpoints_corporation_id_idx" ON "tax_sync_checkpoints" USING btree ("corporation_id");--> statement-breakpoint
CREATE INDEX "tax_sync_checkpoints_source_type_idx" ON "tax_sync_checkpoints" USING btree ("source_type");--> statement-breakpoint
CREATE INDEX "tax_sync_checkpoints_last_successful_sync_at_idx" ON "tax_sync_checkpoints" USING btree ("last_successful_sync_at");
--> statement-breakpoint
INSERT INTO "tax_rule_groups" (
	"id",
	"name",
	"description",
	"is_default_global",
	"is_system",
	"created_by"
) VALUES (
	'00000000-0000-0000-0000-000000000001'::uuid,
	'Alliance Global (default)',
	'System default alliance global rule group',
	true,
	true,
	'system:migration'
) ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "tax_rule_sets" (
	"id",
	"rule_group_id",
	"name",
	"priority",
	"is_active",
	"created_by",
	"applies_to_ref_type",
	"tax_rate_bps"
) VALUES (
	'00000000-0000-0000-0000-000000000010'::uuid,
	'00000000-0000-0000-0000-000000000001'::uuid,
	'Alliance Default Tax',
	0,
	true,
	'system:migration',
	NULL,
	500
) ON CONFLICT ("id") DO NOTHING;
