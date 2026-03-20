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
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tax_member_contribution_finalized_rollups" ADD CONSTRAINT "tax_member_contribution_finalized_rollups_finalized_assessment_id_tax_assessments_id_fk" FOREIGN KEY ("finalized_assessment_id") REFERENCES "public"."tax_assessments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tax_member_final_rollups_corp_period_idx" ON "tax_member_contribution_finalized_rollups" USING btree ("corporation_id","period_start","period_end");--> statement-breakpoint
CREATE INDEX "tax_member_final_rollups_corp_char_period_idx" ON "tax_member_contribution_finalized_rollups" USING btree ("corporation_id","character_id","period_start","period_end");--> statement-breakpoint
CREATE INDEX "tax_member_final_rollups_corp_ref_rollup_date_idx" ON "tax_member_contribution_finalized_rollups" USING btree ("corporation_id","ref_type","rollup_date");--> statement-breakpoint
CREATE INDEX "tax_member_final_rollups_assessment_id_idx" ON "tax_member_contribution_finalized_rollups" USING btree ("finalized_assessment_id");--> statement-breakpoint
CREATE INDEX "tax_member_proj_rollups_corp_period_idx" ON "tax_member_contribution_projection_rollups" USING btree ("corporation_id","period_start","period_end");--> statement-breakpoint
CREATE INDEX "tax_member_proj_rollups_corp_char_period_idx" ON "tax_member_contribution_projection_rollups" USING btree ("corporation_id","character_id","period_start","period_end");--> statement-breakpoint
CREATE INDEX "tax_member_proj_rollups_corp_ref_rollup_date_idx" ON "tax_member_contribution_projection_rollups" USING btree ("corporation_id","ref_type","rollup_date");--> statement-breakpoint
CREATE INDEX "tax_member_summary_versions_updated_at_idx" ON "tax_member_summary_versions" USING btree ("updated_at");