ALTER TABLE "bills" ADD COLUMN IF NOT EXISTS "external_source_type" text;
--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN IF NOT EXISTS "external_source_id" text;
--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN IF NOT EXISTS "external_metadata" jsonb;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bills_external_source_type_idx" ON "bills" USING btree ("external_source_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bills_external_source_id_idx" ON "bills" USING btree ("external_source_id");
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conname = 'bills_external_source_unique'
	) THEN
		ALTER TABLE "bills"
		ADD CONSTRAINT "bills_external_source_unique" UNIQUE("external_source_type","external_source_id");
	END IF;
END $$;
