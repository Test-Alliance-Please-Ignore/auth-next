ALTER TABLE "structure_sovereignty_hubs" DROP CONSTRAINT "structure_sovereignty_hubs_structure_id_corporation_structures_structure_id_fk";
--> statement-breakpoint
ALTER TABLE "structure_sovereignty_systems" DROP CONSTRAINT "structure_sovereignty_systems_sovereignty_hub_structure_id_corporation_structures_structure_id_fk";
--> statement-breakpoint
CREATE INDEX "structure_sovereignty_systems_sovereignty_hub_structure_id_idx" ON "structure_sovereignty_systems" USING btree ("sovereignty_hub_structure_id");--> statement-breakpoint
ALTER TABLE "structure_mining_states" DROP COLUMN "raw_payload";--> statement-breakpoint
ALTER TABLE "structure_skyhook_states" DROP COLUMN "owner_id";--> statement-breakpoint
ALTER TABLE "structure_skyhook_states" DROP COLUMN "raw_payload";--> statement-breakpoint
ALTER TABLE "structure_sovereignty_hubs" DROP COLUMN "owner_id";--> statement-breakpoint
ALTER TABLE "structure_sovereignty_hubs" DROP COLUMN "raw_payload";--> statement-breakpoint
ALTER TABLE "structure_sovereignty_systems" DROP COLUMN "raw_payload";