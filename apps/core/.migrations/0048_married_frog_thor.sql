ALTER TABLE "users" DROP CONSTRAINT "users_legacy_auth_user_id_unique";--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_legacy_auth_user_username_unique";--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_legacy_auth_user_email_hash_unique";--> statement-breakpoint
DROP INDEX "users_legacy_auth_user_id_idx";--> statement-breakpoint
DROP INDEX "users_legacy_auth_user_username_idx";--> statement-breakpoint
DROP INDEX "users_legacy_auth_user_email_hash_idx";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "legacy_auth_user_id";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "legacy_auth_user_username";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "legacy_auth_user_email_hash";