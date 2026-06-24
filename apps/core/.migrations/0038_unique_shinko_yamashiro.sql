CREATE TABLE "mumble_tempop_credential_handoffs" (
	"token_hash" varchar(64) PRIMARY KEY NOT NULL,
	"tempop_id" uuid NOT NULL,
	"credentials" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mumble_tempop_guests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tempop_id" uuid NOT NULL,
	"character_id" varchar(32) NOT NULL,
	"character_name" varchar(255) NOT NULL,
	"corporation_id" varchar(32),
	"alliance_id" varchar(32),
	"corp_ticker" varchar(8),
	"subject_id" varchar(255) NOT NULL,
	"login_name" varchar(60) NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "mumble_tempop_guests_subject_id_unique" UNIQUE("subject_id"),
	CONSTRAINT "mumble_tempop_guests_tempop_character_uq" UNIQUE("tempop_id","character_id")
);
--> statement-breakpoint
CREATE TABLE "mumble_tempops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"short_code" varchar(8) NOT NULL,
	"key_hash" varchar(64) NOT NULL,
	"creator_user_id" uuid NOT NULL,
	"group_name" varchar(120) NOT NULL,
	"ttl_seconds" integer NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"deleted_at" timestamp,
	CONSTRAINT "mumble_tempops_short_code_unique" UNIQUE("short_code"),
	CONSTRAINT "mumble_tempops_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
ALTER TABLE "oauth_states" ADD COLUMN "metadata" jsonb;--> statement-breakpoint
ALTER TABLE "mumble_tempop_credential_handoffs" ADD CONSTRAINT "mumble_tempop_credential_handoffs_tempop_id_mumble_tempops_id_fk" FOREIGN KEY ("tempop_id") REFERENCES "public"."mumble_tempops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mumble_tempop_guests" ADD CONSTRAINT "mumble_tempop_guests_tempop_id_mumble_tempops_id_fk" FOREIGN KEY ("tempop_id") REFERENCES "public"."mumble_tempops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mumble_tempops" ADD CONSTRAINT "mumble_tempops_creator_user_id_users_id_fk" FOREIGN KEY ("creator_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mumble_tempop_credential_handoffs_expires_at_idx" ON "mumble_tempop_credential_handoffs" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "mumble_tempop_guests_tempop_id_idx" ON "mumble_tempop_guests" USING btree ("tempop_id");--> statement-breakpoint
CREATE INDEX "mumble_tempops_status_expires_at_idx" ON "mumble_tempops" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "mumble_tempops_creator_user_id_idx" ON "mumble_tempops" USING btree ("creator_user_id");