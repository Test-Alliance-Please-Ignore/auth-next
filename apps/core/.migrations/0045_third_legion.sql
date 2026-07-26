ALTER TABLE "service_access_audit_runs" ADD COLUMN "basis_acknowledged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "service_access_audit_runs" ADD COLUMN "basis_acknowledged_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "service_access_audit_runs" ADD COLUMN "basis_acknowledged_reason" text;--> statement-breakpoint
ALTER TABLE "service_access_audit_runs" ADD CONSTRAINT "service_access_audit_runs_basis_acknowledged_by_user_id_users_id_fk" FOREIGN KEY ("basis_acknowledged_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "service_access_audit_runs_basis_acknowledged_at_idx" ON "service_access_audit_runs" USING btree ("basis_acknowledged_at");--> statement-breakpoint
CREATE INDEX "service_access_audit_runs_member_corp_count_idx" ON "service_access_audit_runs" USING btree ("started_at","member_corp_count");