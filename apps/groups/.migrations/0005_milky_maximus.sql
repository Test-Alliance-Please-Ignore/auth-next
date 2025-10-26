CREATE TYPE "public"."permission_target" AS ENUM('all_members', 'all_admins', 'owner_only', 'owner_and_admins');--> statement-breakpoint
CREATE TABLE "group_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"permission_id" uuid,
	"custom_urn" text,
	"custom_name" varchar(255),
	"custom_description" text,
	"target_type" "permission_target" NOT NULL,
	"created_by" varchar(255) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "unique_group_permission" UNIQUE("group_id","permission_id")
);
--> statement-breakpoint
CREATE TABLE "permission_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "permission_categories_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"urn" text NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"category_id" uuid,
	"created_by" varchar(255) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "permissions_urn_unique" UNIQUE("urn")
);
--> statement-breakpoint
ALTER TABLE "group_permissions" ADD CONSTRAINT "group_permissions_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_permissions" ADD CONSTRAINT "group_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permissions" ADD CONSTRAINT "permissions_category_id_permission_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."permission_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "group_permissions_group_id_idx" ON "group_permissions" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "group_permissions_permission_id_idx" ON "group_permissions" USING btree ("permission_id");--> statement-breakpoint
CREATE INDEX "group_permissions_custom_urn_idx" ON "group_permissions" USING btree ("custom_urn");--> statement-breakpoint
CREATE INDEX "permission_categories_name_idx" ON "permission_categories" USING btree ("name");--> statement-breakpoint
CREATE INDEX "permissions_urn_idx" ON "permissions" USING btree ("urn");--> statement-breakpoint
CREATE INDEX "permissions_category_id_idx" ON "permissions" USING btree ("category_id");