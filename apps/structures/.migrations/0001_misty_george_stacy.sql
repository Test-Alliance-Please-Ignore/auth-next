ALTER TABLE "structure_state_events" RENAME COLUMN "owner_id" TO "corporation_id";--> statement-breakpoint
ALTER TABLE "structure_state_events" DROP CONSTRAINT "structure_state_events_owner_id_managed_corporations_corporation_id_fk";
--> statement-breakpoint
DROP INDEX "structure_state_events_owner_id_idx";--> statement-breakpoint
ALTER TABLE "structure_state_events" ADD CONSTRAINT "structure_state_events_corporation_id_managed_corporations_corporation_id_fk" FOREIGN KEY ("corporation_id") REFERENCES "public"."managed_corporations"("corporation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "structure_state_events_corporation_id_idx" ON "structure_state_events" USING btree ("corporation_id");