CREATE TABLE "fleet_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" text NOT NULL,
	"fleet_boss_id" text NOT NULL,
	"fleet_id" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"max_uses" integer,
	"uses_count" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "fleet_invitations_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "fleet_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"character_id" text NOT NULL,
	"fleet_id" text NOT NULL,
	"invitation_id" uuid,
	"joined_at" timestamp DEFAULT now() NOT NULL,
	"role" text DEFAULT 'squad_member' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fleet_state_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fleet_id" text NOT NULL,
	"fleet_boss_id" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"member_count" integer DEFAULT 0 NOT NULL,
	"motd" text,
	"is_free_move" boolean DEFAULT false NOT NULL,
	"is_registered" boolean DEFAULT false NOT NULL,
	"is_voice_enabled" boolean DEFAULT false NOT NULL,
	"last_checked" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "fleet_state_cache_fleet_id_unique" UNIQUE("fleet_id")
);
--> statement-breakpoint
ALTER TABLE "fleet_memberships" ADD CONSTRAINT "fleet_memberships_invitation_id_fleet_invitations_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."fleet_invitations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fleet_invitations_token_idx" ON "fleet_invitations" USING btree ("token");--> statement-breakpoint
CREATE INDEX "fleet_invitations_expires_at_idx" ON "fleet_invitations" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "fleet_invitations_fleet_boss_id_idx" ON "fleet_invitations" USING btree ("fleet_boss_id");--> statement-breakpoint
CREATE INDEX "fleet_memberships_character_id_idx" ON "fleet_memberships" USING btree ("character_id");--> statement-breakpoint
CREATE INDEX "fleet_memberships_fleet_id_idx" ON "fleet_memberships" USING btree ("fleet_id");--> statement-breakpoint
CREATE INDEX "fleet_memberships_invitation_id_idx" ON "fleet_memberships" USING btree ("invitation_id");--> statement-breakpoint
CREATE INDEX "fleet_state_cache_fleet_id_idx" ON "fleet_state_cache" USING btree ("fleet_id");--> statement-breakpoint
CREATE INDEX "fleet_state_cache_fleet_boss_id_idx" ON "fleet_state_cache" USING btree ("fleet_boss_id");--> statement-breakpoint
CREATE INDEX "fleet_state_cache_last_checked_idx" ON "fleet_state_cache" USING btree ("last_checked");