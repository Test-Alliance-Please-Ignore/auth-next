ALTER TABLE "eve_characters" ADD COLUMN "last_data_sync_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "eve_characters" ADD COLUMN "last_data_sync_attempt_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "eve_characters_last_data_sync_at_idx" ON "eve_characters" USING btree ("last_data_sync_at");--> statement-breakpoint
CREATE INDEX "eve_characters_last_data_sync_attempt_at_idx" ON "eve_characters" USING btree ("last_data_sync_attempt_at");