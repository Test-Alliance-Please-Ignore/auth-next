CREATE TABLE "groups_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "groups_categories_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "groups_derived_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"derived_group_id" uuid NOT NULL,
	"rule_type" varchar(50) NOT NULL,
	"source_group_ids" text,
	"condition_rules" text,
	"priority" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "groups_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(255) NOT NULL,
	"description" text,
	"group_type" varchar(50) NOT NULL,
	"visibility" varchar(50) NOT NULL,
	"joinability" varchar(50) NOT NULL,
	"is_leaveable" boolean DEFAULT true NOT NULL,
	"auto_approve_rules" text,
	"owner_id" uuid,
	"category_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "groups_groups_name_unique" UNIQUE("name"),
	CONSTRAINT "groups_groups_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "groups_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"invited_user_id" uuid,
	"invited_by" uuid NOT NULL,
	"invite_code" varchar(12),
	"status" varchar(50) NOT NULL,
	"max_uses" integer,
	"current_uses" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "groups_invites_invite_code_unique" UNIQUE("invite_code")
);
--> statement-breakpoint
CREATE TABLE "groups_join_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"root_user_id" uuid NOT NULL,
	"message" text,
	"status" varchar(50) NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "groups_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"root_user_id" uuid NOT NULL,
	"role" varchar(50) NOT NULL,
	"status" varchar(50) NOT NULL,
	"assignment_type" varchar(50) NOT NULL,
	"can_leave" boolean DEFAULT true NOT NULL,
	"joined_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "groups_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"role_name" varchar(50) NOT NULL,
	"permissions" text,
	"priority" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "groups_derived_rules" ADD CONSTRAINT "groups_derived_rules_derived_group_id_groups_groups_id_fk" FOREIGN KEY ("derived_group_id") REFERENCES "public"."groups_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups_invites" ADD CONSTRAINT "groups_invites_group_id_groups_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups_join_requests" ADD CONSTRAINT "groups_join_requests_group_id_groups_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups_members" ADD CONSTRAINT "groups_members_group_id_groups_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups_roles" ADD CONSTRAINT "groups_roles_group_id_groups_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "groups_categories_name_idx" ON "groups_categories" USING btree ("name");--> statement-breakpoint
CREATE INDEX "groups_categories_order_idx" ON "groups_categories" USING btree ("display_order");--> statement-breakpoint
CREATE INDEX "groups_derived_rules_group_idx" ON "groups_derived_rules" USING btree ("derived_group_id");--> statement-breakpoint
CREATE INDEX "groups_derived_rules_active_idx" ON "groups_derived_rules" USING btree ("is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "groups_groups_name_idx" ON "groups_groups" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "groups_groups_slug_idx" ON "groups_groups" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "groups_groups_type_idx" ON "groups_groups" USING btree ("group_type");--> statement-breakpoint
CREATE INDEX "groups_groups_category_idx" ON "groups_groups" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "groups_groups_owner_idx" ON "groups_groups" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "groups_invites_group_user_idx" ON "groups_invites" USING btree ("group_id","invited_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "groups_invites_code_idx" ON "groups_invites" USING btree ("invite_code");--> statement-breakpoint
CREATE INDEX "groups_invites_status_idx" ON "groups_invites" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "groups_requests_unique_idx" ON "groups_join_requests" USING btree ("group_id","root_user_id");--> statement-breakpoint
CREATE INDEX "groups_requests_group_idx" ON "groups_join_requests" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "groups_requests_user_idx" ON "groups_join_requests" USING btree ("root_user_id");--> statement-breakpoint
CREATE INDEX "groups_requests_status_idx" ON "groups_join_requests" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "groups_members_unique_idx" ON "groups_members" USING btree ("group_id","root_user_id");--> statement-breakpoint
CREATE INDEX "groups_members_group_idx" ON "groups_members" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "groups_members_user_idx" ON "groups_members" USING btree ("root_user_id");--> statement-breakpoint
CREATE INDEX "groups_members_status_idx" ON "groups_members" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "groups_roles_unique_idx" ON "groups_roles" USING btree ("group_id","role_name");--> statement-breakpoint
CREATE INDEX "groups_roles_group_idx" ON "groups_roles" USING btree ("group_id");