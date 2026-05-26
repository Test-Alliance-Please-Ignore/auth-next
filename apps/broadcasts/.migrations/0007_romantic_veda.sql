CREATE TYPE "public"."broadcast_srp_mode" AS ENUM('blanket', 'military', 'coalition', 'disabled');--> statement-breakpoint
CREATE TABLE "broadcast_session_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"broadcast_id" uuid NOT NULL,
	"srp_mode" "broadcast_srp_mode",
	"srp_token" varchar(255),
	"doctrine_id" uuid,
	"fleet_session_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "broadcast_session_links" ADD CONSTRAINT "broadcast_session_links_broadcast_id_broadcasts_id_fk" FOREIGN KEY ("broadcast_id") REFERENCES "public"."broadcasts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "broadcast_session_links_broadcast_id_unique" ON "broadcast_session_links" USING btree ("broadcast_id");--> statement-breakpoint
CREATE UNIQUE INDEX "broadcast_session_links_srp_token_unique" ON "broadcast_session_links" USING btree ("srp_token");--> statement-breakpoint
CREATE INDEX "broadcast_session_links_doctrine_id_idx" ON "broadcast_session_links" USING btree ("doctrine_id");--> statement-breakpoint
CREATE INDEX "broadcast_session_links_fleet_session_id_idx" ON "broadcast_session_links" USING btree ("fleet_session_id");