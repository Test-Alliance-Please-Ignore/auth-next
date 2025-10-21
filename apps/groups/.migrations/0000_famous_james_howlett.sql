CREATE TYPE "public"."category_permission" AS ENUM('anyone', 'admin_only');--> statement-breakpoint
CREATE TYPE "public"."invitation_status" AS ENUM('pending', 'accepted', 'declined', 'expired');--> statement-breakpoint
CREATE TYPE "public"."join_mode" AS ENUM('open', 'approval', 'invitation_only');--> statement-breakpoint
CREATE TYPE "public"."join_request_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."visibility" AS ENUM('public', 'hidden', 'system');--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"visibility" "visibility" DEFAULT 'public' NOT NULL,
	"allow_group_creation" "category_permission" DEFAULT 'anyone' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "categories_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "group_admins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"designated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "unique_group_admin" UNIQUE("group_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "group_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"inviter_id" varchar(255) NOT NULL,
	"invitee_main_character_id" bigint NOT NULL,
	"invitee_user_id" varchar(255),
	"status" "invitation_status" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"responded_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "group_invite_code_redemptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invite_code_id" uuid NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"redeemed_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "unique_code_redemption" UNIQUE("invite_code_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "group_invite_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"code" varchar(32) NOT NULL,
	"created_by" varchar(255) NOT NULL,
	"max_uses" integer,
	"current_uses" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"revoked_at" timestamp,
	CONSTRAINT "group_invite_codes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "group_join_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"reason" text,
	"status" "join_request_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"responded_at" timestamp,
	"responded_by" varchar(255),
	CONSTRAINT "unique_pending_join_request" UNIQUE("group_id","user_id","status")
);
--> statement-breakpoint
CREATE TABLE "group_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"joined_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "unique_group_member" UNIQUE("group_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"visibility" "visibility" DEFAULT 'public' NOT NULL,
	"join_mode" "join_mode" DEFAULT 'open' NOT NULL,
	"owner_id" varchar(255) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "unique_group_name_per_category" UNIQUE("category_id","name")
);
--> statement-breakpoint
ALTER TABLE "group_admins" ADD CONSTRAINT "group_admins_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_invitations" ADD CONSTRAINT "group_invitations_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_invite_code_redemptions" ADD CONSTRAINT "group_invite_code_redemptions_invite_code_id_group_invite_codes_id_fk" FOREIGN KEY ("invite_code_id") REFERENCES "public"."group_invite_codes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_invite_codes" ADD CONSTRAINT "group_invite_codes_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_join_requests" ADD CONSTRAINT "group_join_requests_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "categories_visibility_idx" ON "categories" USING btree ("visibility");--> statement-breakpoint
CREATE INDEX "group_admins_group_id_idx" ON "group_admins" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "group_admins_user_id_idx" ON "group_admins" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "group_invitations_group_id_idx" ON "group_invitations" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "group_invitations_invitee_user_id_idx" ON "group_invitations" USING btree ("invitee_user_id");--> statement-breakpoint
CREATE INDEX "group_invitations_status_idx" ON "group_invitations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "group_invitations_expires_at_idx" ON "group_invitations" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "group_invite_code_redemptions_invite_code_id_idx" ON "group_invite_code_redemptions" USING btree ("invite_code_id");--> statement-breakpoint
CREATE INDEX "group_invite_code_redemptions_user_id_idx" ON "group_invite_code_redemptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "group_invite_codes_group_id_idx" ON "group_invite_codes" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "group_invite_codes_code_idx" ON "group_invite_codes" USING btree ("code");--> statement-breakpoint
CREATE INDEX "group_invite_codes_expires_at_idx" ON "group_invite_codes" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "group_join_requests_group_id_idx" ON "group_join_requests" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "group_join_requests_user_id_idx" ON "group_join_requests" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "group_join_requests_status_idx" ON "group_join_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "group_members_group_id_idx" ON "group_members" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "group_members_user_id_idx" ON "group_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "groups_category_id_idx" ON "groups" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "groups_owner_id_idx" ON "groups" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "groups_visibility_idx" ON "groups" USING btree ("visibility");