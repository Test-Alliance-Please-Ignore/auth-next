CREATE TABLE "corporation_structure_inventory_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"corporation_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "corporation_structure_inventory" DROP CONSTRAINT "corporation_structure_inventory_corporation_id_item_id_unique";--> statement-breakpoint
ALTER TABLE "corporation_structure_inventory" ADD COLUMN "snapshot_id" uuid;--> statement-breakpoint
ALTER TABLE "corporation_structure_inventory_snapshots" ADD CONSTRAINT "corp_inv_snapshots_corp_fk" FOREIGN KEY ("corporation_id") REFERENCES "public"."corporation_config"("corporation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "corporation_structure_inventory_snapshots_corp_activated_idx" ON "corporation_structure_inventory_snapshots" USING btree ("corporation_id","activated_at","created_at");--> statement-breakpoint
ALTER TABLE "corporation_structure_inventory" ADD CONSTRAINT "corp_inv_snapshot_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."corporation_structure_inventory_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "corporation_structure_inventory_snapshot_structure_idx" ON "corporation_structure_inventory" USING btree ("snapshot_id","corporation_id","structure_id");--> statement-breakpoint
ALTER TABLE "corporation_structure_inventory" ADD CONSTRAINT "corp_inv_snapshot_item_uniq" UNIQUE("corporation_id","snapshot_id","item_id");