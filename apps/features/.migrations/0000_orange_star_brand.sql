CREATE TABLE "feature_flags" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"value_type" text DEFAULT 'boolean' NOT NULL,
	"boolean_value" boolean,
	"json_value" jsonb,
	"description" text,
	"tags" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "feature_flags_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE INDEX "feature_flags_tags_idx" ON "feature_flags" USING gin ("tags");