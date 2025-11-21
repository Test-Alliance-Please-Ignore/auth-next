ALTER TABLE "groups_role_attachments" ADD COLUMN "resource_id" varchar(255) NOT NULL;--> statement-breakpoint
ALTER TABLE "groups_role_attachments" ADD COLUMN "resource_type" varchar(255) NOT NULL;--> statement-breakpoint
CREATE INDEX "groups_role_attachments_resource_id_idx" ON "groups_role_attachments" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "groups_role_attachments_resource_type_idx" ON "groups_role_attachments" USING btree ("resource_type");