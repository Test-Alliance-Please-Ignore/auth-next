CREATE TABLE "corporation_structure_pos_details" (
	"structure_id" text PRIMARY KEY NOT NULL,
	"corporation_id" text NOT NULL,
	"last_attempted_sync_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"sync_failure_reason" text
);
--> statement-breakpoint
ALTER TABLE "corporation_structure_pos_details" ADD CONSTRAINT "corporation_structure_pos_details_structure_id_corporation_structures_structure_id_fk" FOREIGN KEY ("structure_id") REFERENCES "public"."corporation_structures"("structure_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "corp_pos_detail_sync_idx" ON "corporation_structure_pos_details" USING btree ("corporation_id","last_synced_at","last_attempted_sync_at");