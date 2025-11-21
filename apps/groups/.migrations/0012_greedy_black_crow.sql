CREATE TABLE "groups_role_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role_id" uuid NOT NULL,
	"attached_to_type" varchar(255) NOT NULL,
	"attached_to_id" varchar(255) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "unique_group_role_attachment" UNIQUE("role_id","attached_to_type","attached_to_id")
);
--> statement-breakpoint
ALTER TABLE "groups_role_attachments" ADD CONSTRAINT "groups_role_attachments_role_id_groups_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."groups_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "groups_role_attachments_role_id_idx" ON "groups_role_attachments" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "groups_role_attachments_attached_to_type_idx" ON "groups_role_attachments" USING btree ("attached_to_type");--> statement-breakpoint
CREATE INDEX "groups_role_attachments_attached_to_id_idx" ON "groups_role_attachments" USING btree ("attached_to_id");