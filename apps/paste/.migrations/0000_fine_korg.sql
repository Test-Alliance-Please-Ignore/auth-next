CREATE TABLE "paste_settings" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"create_rate_limit_count" integer DEFAULT 1 NOT NULL,
	"create_rate_limit_window_minutes" integer DEFAULT 1 NOT NULL,
	"max_active_pastes_per_user" integer DEFAULT 50 NOT NULL,
	"updated_by_user_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pastes" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_by_character_id" text,
	"created_by_character_name" text,
	"visibility" text DEFAULT 'alliance' NOT NULL,
	"is_password_protected" integer DEFAULT 0 NOT NULL,
	"encryption_version" text,
	"kdf" text,
	"kdf_iterations" integer,
	"kdf_salt" text,
	"cipher" text,
	"cipher_iv" text,
	"r2_bucket" text NOT NULL,
	"r2_key" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"content_type" text DEFAULT 'text/plain' NOT NULL,
	"expires_at" timestamp with time zone,
	"last_accessed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "pastes_created_by_user_id_idx" ON "pastes" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "pastes_visibility_idx" ON "pastes" USING btree ("visibility");--> statement-breakpoint
CREATE INDEX "pastes_expires_at_idx" ON "pastes" USING btree ("expires_at");