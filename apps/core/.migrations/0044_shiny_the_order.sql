ALTER TABLE "service_access_audit_runs" ADD COLUMN "basis_suspect" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "service_access_audit_runs" ADD COLUMN "basis_compared_to_count" integer;--> statement-breakpoint
ALTER TABLE "service_access_audit_runs" ADD COLUMN "basis_removed_corporation_ids" text[];--> statement-breakpoint
ALTER TABLE "service_access_audit_runs" ADD COLUMN "basis_note" text;