ALTER TABLE "user_characters" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
CREATE INDEX "user_characters_status_idx" ON "user_characters" USING btree ("status");