CREATE TABLE "structure_mining_extraction_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"structure_id" text NOT NULL,
	"corporation_id" text NOT NULL,
	"moon_id" text NOT NULL,
	"extraction_start_time" timestamp with time zone NOT NULL,
	"chunk_arrival_time" timestamp with time zone NOT NULL,
	"natural_decay_time" timestamp with time zone NOT NULL,
	"first_observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sm_extract_hist_identity_key" UNIQUE("structure_id","extraction_start_time","chunk_arrival_time","natural_decay_time")
);
--> statement-breakpoint
ALTER TABLE "structure_mining_extraction_history" ADD CONSTRAINT "structure_mining_extraction_history_structure_id_corporation_structures_structure_id_fk" FOREIGN KEY ("structure_id") REFERENCES "public"."corporation_structures"("structure_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "structure_mining_extraction_history" ADD CONSTRAINT "structure_mining_extraction_history_corporation_id_managed_corporations_corporation_id_fk" FOREIGN KEY ("corporation_id") REFERENCES "public"."managed_corporations"("corporation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sm_citadel_extract_hist_structure_idx" ON "structure_mining_extraction_history" USING btree ("structure_id");--> statement-breakpoint
CREATE INDEX "sm_citadel_extract_hist_corp_idx" ON "structure_mining_extraction_history" USING btree ("corporation_id");--> statement-breakpoint
CREATE INDEX "sm_citadel_extract_hist_start_idx" ON "structure_mining_extraction_history" USING btree ("extraction_start_time");