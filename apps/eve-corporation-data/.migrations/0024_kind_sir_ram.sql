CREATE TABLE "structure_mining_citadel_extractions" (
	"structure_id" text PRIMARY KEY NOT NULL,
	"corporation_id" text NOT NULL,
	"moon_id" text NOT NULL,
	"moon_name" text,
	"planet_id" text,
	"planet_name" text,
	"system_id" text,
	"system_name" text,
	"extraction_start_time" timestamp with time zone,
	"chunk_arrival_time" timestamp with time zone,
	"natural_decay_time" timestamp with time zone,
	"source_sync_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "structure_moon_drills" (
	"structure_id" text PRIMARY KEY NOT NULL,
	"corporation_id" text NOT NULL,
	"moon_id" text NOT NULL,
	"moon_name" text,
	"planet_id" text,
	"planet_name" text,
	"system_id" text,
	"system_name" text,
	"source_sync_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "structure_skyhooks" (
	"structure_id" text PRIMARY KEY NOT NULL,
	"corporation_id" text NOT NULL,
	"planet_id" text,
	"planet_name" text,
	"system_id" text,
	"system_name" text,
	"name" text,
	"type_id" text NOT NULL,
	"state" text NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"effective_workforce" integer,
	"reagents" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reinforcement_timer_end" timestamp with time zone,
	"theft_vulnerability_start" timestamp with time zone,
	"theft_vulnerability_end" timestamp with time zone,
	"is_raidable" boolean DEFAULT false NOT NULL,
	"becomes_raidable_at" timestamp with time zone,
	"vulnerable_at" timestamp with time zone,
	"last_observed_at" timestamp with time zone,
	"source_sync_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP TABLE "structure_mining_states" CASCADE;--> statement-breakpoint
DROP TABLE "structure_skyhook_states" CASCADE;--> statement-breakpoint
ALTER TABLE "structure_mining_citadel_extractions" ADD CONSTRAINT "structure_mining_citadel_extractions_structure_id_corporation_structures_structure_id_fk" FOREIGN KEY ("structure_id") REFERENCES "public"."corporation_structures"("structure_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "structure_mining_citadel_extractions" ADD CONSTRAINT "structure_mining_citadel_extractions_corporation_id_managed_corporations_corporation_id_fk" FOREIGN KEY ("corporation_id") REFERENCES "public"."managed_corporations"("corporation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "structure_moon_drills" ADD CONSTRAINT "structure_moon_drills_structure_id_corporation_structures_structure_id_fk" FOREIGN KEY ("structure_id") REFERENCES "public"."corporation_structures"("structure_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "structure_moon_drills" ADD CONSTRAINT "structure_moon_drills_corporation_id_managed_corporations_corporation_id_fk" FOREIGN KEY ("corporation_id") REFERENCES "public"."managed_corporations"("corporation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "structure_skyhooks" ADD CONSTRAINT "structure_skyhooks_structure_id_corporation_structures_structure_id_fk" FOREIGN KEY ("structure_id") REFERENCES "public"."corporation_structures"("structure_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "structure_skyhooks" ADD CONSTRAINT "structure_skyhooks_corporation_id_managed_corporations_corporation_id_fk" FOREIGN KEY ("corporation_id") REFERENCES "public"."managed_corporations"("corporation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "structure_mining_citadel_extractions_corporation_id_idx" ON "structure_mining_citadel_extractions" USING btree ("corporation_id");--> statement-breakpoint
CREATE INDEX "structure_mining_citadel_extractions_moon_id_idx" ON "structure_mining_citadel_extractions" USING btree ("moon_id");--> statement-breakpoint
CREATE INDEX "structure_mining_citadel_extractions_planet_id_idx" ON "structure_mining_citadel_extractions" USING btree ("planet_id");--> statement-breakpoint
CREATE INDEX "structure_mining_citadel_extractions_system_id_idx" ON "structure_mining_citadel_extractions" USING btree ("system_id");--> statement-breakpoint
CREATE INDEX "structure_mining_citadel_extractions_last_synced_at_idx" ON "structure_mining_citadel_extractions" USING btree ("last_synced_at");--> statement-breakpoint
CREATE INDEX "structure_moon_drills_corporation_id_idx" ON "structure_moon_drills" USING btree ("corporation_id");--> statement-breakpoint
CREATE INDEX "structure_moon_drills_moon_id_idx" ON "structure_moon_drills" USING btree ("moon_id");--> statement-breakpoint
CREATE INDEX "structure_moon_drills_planet_id_idx" ON "structure_moon_drills" USING btree ("planet_id");--> statement-breakpoint
CREATE INDEX "structure_moon_drills_system_id_idx" ON "structure_moon_drills" USING btree ("system_id");--> statement-breakpoint
CREATE INDEX "structure_moon_drills_last_synced_at_idx" ON "structure_moon_drills" USING btree ("last_synced_at");--> statement-breakpoint
CREATE INDEX "structure_skyhooks_corporation_id_idx" ON "structure_skyhooks" USING btree ("corporation_id");--> statement-breakpoint
CREATE INDEX "structure_skyhooks_planet_id_idx" ON "structure_skyhooks" USING btree ("planet_id");--> statement-breakpoint
CREATE INDEX "structure_skyhooks_system_id_idx" ON "structure_skyhooks" USING btree ("system_id");--> statement-breakpoint
CREATE INDEX "structure_skyhooks_type_id_idx" ON "structure_skyhooks" USING btree ("type_id");--> statement-breakpoint
CREATE INDEX "structure_skyhooks_is_raidable_idx" ON "structure_skyhooks" USING btree ("is_raidable");--> statement-breakpoint
CREATE INDEX "structure_skyhooks_last_synced_at_idx" ON "structure_skyhooks" USING btree ("last_synced_at");