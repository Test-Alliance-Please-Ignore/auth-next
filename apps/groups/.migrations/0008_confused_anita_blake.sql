CREATE TABLE "corporation_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"corporation_id" text NOT NULL,
	"permission_id" uuid NOT NULL,
	"created_by" varchar(255) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "unique_corporation_permission" UNIQUE("corporation_id","permission_id")
);
--> statement-breakpoint
ALTER TABLE "corporation_permissions" ADD CONSTRAINT "corporation_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "corporation_permissions_corp_id_idx" ON "corporation_permissions" USING btree ("corporation_id");--> statement-breakpoint
CREATE INDEX "corporation_permissions_permission_id_idx" ON "corporation_permissions" USING btree ("permission_id");