DROP TABLE "user_roles" CASCADE;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_admin" timestamp DEFAULT null;