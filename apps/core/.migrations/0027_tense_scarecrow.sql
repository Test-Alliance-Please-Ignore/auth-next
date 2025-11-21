ALTER TABLE "user_characters" ADD COLUMN "deleted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "user_characters_deleted_idx" ON "user_characters" USING btree ("deleted");