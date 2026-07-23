CREATE TABLE "structure_skyhook_reagents" (
	"structure_id" text PRIMARY KEY NOT NULL,
	"corporation_id" text NOT NULL,
	"magmatic_gas_secured_stock" integer DEFAULT 0 NOT NULL,
	"magmatic_gas_unsecured_stock" integer DEFAULT 0 NOT NULL,
	"magmatic_gas_last_cycle" timestamp with time zone,
	"superionic_ice_secured_stock" integer DEFAULT 0 NOT NULL,
	"superionic_ice_unsecured_stock" integer DEFAULT 0 NOT NULL,
	"superionic_ice_last_cycle" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "structure_skyhook_reagents" ADD CONSTRAINT "structure_skyhook_reagents_structure_id_corporation_structures_structure_id_fk" FOREIGN KEY ("structure_id") REFERENCES "public"."corporation_structures"("structure_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "structure_skyhook_reagents" ADD CONSTRAINT "structure_skyhook_reagents_corporation_id_managed_corporations_corporation_id_fk" FOREIGN KEY ("corporation_id") REFERENCES "public"."managed_corporations"("corporation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "structure_skyhook_reagents_corporation_id_idx" ON "structure_skyhook_reagents" USING btree ("corporation_id");--> statement-breakpoint
ALTER TABLE "structure_skyhooks" DROP COLUMN "reagents";