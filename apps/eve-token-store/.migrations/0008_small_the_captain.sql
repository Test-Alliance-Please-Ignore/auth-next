ALTER TABLE "eve_tokens" ADD COLUMN "invalid_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "eve_tokens" ADD COLUMN "last_validation_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "eve_tokens" ADD COLUMN "last_validation_status" varchar(64);--> statement-breakpoint
ALTER TABLE "eve_tokens" ADD COLUMN "next_retry_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "eve_tokens" ADD COLUMN "permanent_invalid_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "eve_tokens" ADD COLUMN "permanent_invalid_reason" text;--> statement-breakpoint
CREATE INDEX "eve_tokens_next_retry_at_idx" ON "eve_tokens" USING btree ("next_retry_at");--> statement-breakpoint
CREATE INDEX "eve_tokens_permanent_invalid_at_idx" ON "eve_tokens" USING btree ("permanent_invalid_at");--> statement-breakpoint
CREATE INDEX "eve_tokens_last_validation_status_idx" ON "eve_tokens" USING btree ("last_validation_status");