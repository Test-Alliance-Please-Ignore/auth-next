ALTER TABLE "corporation_directors"
	ADD COLUMN "next_retry_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "corporation_directors"
	ADD COLUMN "permanent_failure_at" timestamp with time zone;
--> statement-breakpoint
CREATE INDEX "corporation_directors_corp_next_retry_idx"
	ON "corporation_directors" USING btree ("corporation_id","next_retry_at");
--> statement-breakpoint
CREATE INDEX "corporation_directors_corp_permanent_failure_idx"
	ON "corporation_directors" USING btree ("corporation_id","permanent_failure_at");
