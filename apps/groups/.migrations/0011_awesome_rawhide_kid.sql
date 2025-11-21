CREATE TABLE "groups_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"owned_by" varchar(255) NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "unique_group_role" UNIQUE("owned_by","name")
);
--> statement-breakpoint
CREATE INDEX "groups_roles_owned_by_idx" ON "groups_roles" USING btree ("owned_by");--> statement-breakpoint
CREATE INDEX "groups_roles_name_idx" ON "groups_roles" USING btree ("name");