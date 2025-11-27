CREATE TABLE "user_ip_addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"addr" "inet" NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_ip_addresses" ADD CONSTRAINT "user_ip_addresses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_ip_addresses_user_id_idx" ON "user_ip_addresses" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_ip_addresses_ip_address_idx" ON "user_ip_addresses" USING btree ("addr");--> statement-breakpoint
CREATE INDEX "user_ip_address_user_id_ip_address_idx" ON "user_ip_addresses" USING btree ("user_id","addr");