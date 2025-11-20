ALTER TABLE "users" ADD COLUMN "legacy_auth_user_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "legacy_auth_user_username" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "legacy_auth_user_email_hash" text;--> statement-breakpoint
CREATE INDEX "users_legacy_auth_user_id_idx" ON "users" USING btree ("legacy_auth_user_id");--> statement-breakpoint
CREATE INDEX "users_legacy_auth_user_username_idx" ON "users" USING btree ("legacy_auth_user_username");--> statement-breakpoint
CREATE INDEX "users_legacy_auth_user_email_hash_idx" ON "users" USING btree ("legacy_auth_user_email_hash");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_legacy_auth_user_id_unique" UNIQUE("legacy_auth_user_id");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_legacy_auth_user_username_unique" UNIQUE("legacy_auth_user_username");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_legacy_auth_user_email_hash_unique" UNIQUE("legacy_auth_user_email_hash");