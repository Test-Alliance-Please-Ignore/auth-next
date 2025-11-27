CREATE TABLE "minder_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"core_user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "minder_users_core_user_id_unique" UNIQUE("core_user_id")
);
--> statement-breakpoint
CREATE INDEX "minder_users_core_user_id_idx" ON "minder_users" USING btree ("core_user_id");