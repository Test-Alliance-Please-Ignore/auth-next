CREATE TABLE "structure_fuel_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"corporation_id" text NOT NULL,
	"structure_id" text NOT NULL,
	"fuel_block_units" integer NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "corporation_structures" ADD COLUMN "last_refilled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "structure_fuel_log" ADD CONSTRAINT "structure_fuel_log_corporation_id_corporation_config_corporation_id_fk" FOREIGN KEY ("corporation_id") REFERENCES "public"."corporation_config"("corporation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "structure_fuel_log" ADD CONSTRAINT "structure_fuel_log_structure_id_corporation_structures_structure_id_fk" FOREIGN KEY ("structure_id") REFERENCES "public"."corporation_structures"("structure_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "structure_fuel_log_corp_structure_observed_idx" ON "structure_fuel_log" USING btree ("corporation_id","structure_id","observed_at");