CREATE TABLE "core_services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"icon" text,
	"description" text,
	"enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_fingerprints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_ip_addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"addr" "inet" NOT NULL,
	"ip_address_hash" text NOT NULL,
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_ip_addresses_user_ip_unique" UNIQUE("user_id","addr")
);
--> statement-breakpoint
CREATE TABLE "core_user_services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "core_user_services_user_id_service_id_unique" UNIQUE("user_id","service_id")
);
--> statement-breakpoint
ALTER TABLE "user_fingerprints" ADD CONSTRAINT "user_fingerprints_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_ip_addresses" ADD CONSTRAINT "user_ip_addresses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_user_services" ADD CONSTRAINT "core_user_services_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_user_services" ADD CONSTRAINT "core_user_services_service_id_core_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."core_services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "core_services_enabled_idx" ON "core_services" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "core_services_name_idx" ON "core_services" USING btree ("name");--> statement-breakpoint
CREATE INDEX "core_services_slug_idx" ON "core_services" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "user_fingerprints_user_id_idx" ON "user_fingerprints" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_fingerprints_fingerprint_idx" ON "user_fingerprints" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX "user_fingerprints_user_id_fingerprint_idx" ON "user_fingerprints" USING btree ("user_id","fingerprint");--> statement-breakpoint
CREATE INDEX "user_ip_addresses_user_id_idx" ON "user_ip_addresses" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_ip_addresses_ip_address_idx" ON "user_ip_addresses" USING btree ("addr");--> statement-breakpoint
CREATE INDEX "core_user_services_user_id_idx" ON "core_user_services" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "core_user_services_service_id_idx" ON "core_user_services" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "core_user_services_user_id_service_id_idx" ON "core_user_services" USING btree ("user_id","service_id");--> statement-breakpoint
CREATE INDEX "core_user_services_enabled_idx" ON "core_user_services" USING btree ("enabled");