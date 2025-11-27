CREATE TABLE "user_fingerprints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_ip_addresses" ADD COLUMN "ip_address_hash" text NOT NULL;--> statement-breakpoint
ALTER TABLE "user_ip_addresses" ADD COLUMN "first_seen_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "user_ip_addresses" ADD COLUMN "last_seen_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "user_fingerprints" ADD CONSTRAINT "user_fingerprints_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_fingerprints_user_id_idx" ON "user_fingerprints" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_fingerprints_fingerprint_idx" ON "user_fingerprints" USING btree ("fingerprint");