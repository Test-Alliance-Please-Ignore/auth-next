CREATE TYPE "public"."corporation_type" AS ENUM('member', 'alt', 'special_purpose', 'other');--> statement-breakpoint
ALTER TABLE "corporation_config" ADD COLUMN "corporation_type" "corporation_type" DEFAULT 'other' NOT NULL;--> statement-breakpoint
CREATE INDEX "corporation_config_corporation_type_idx" ON "corporation_config" USING btree ("corporation_type");