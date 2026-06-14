CREATE TABLE "corporation_structure_inventory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"corporation_id" text NOT NULL,
	"structure_id" text NOT NULL,
	"item_id" text NOT NULL,
	"is_singleton" boolean DEFAULT false NOT NULL,
	"location_flag" text NOT NULL,
	"location_type" text NOT NULL,
	"quantity" integer NOT NULL,
	"type_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "corporation_structure_inventory_corporation_id_item_id_unique" UNIQUE("corporation_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "structure_mining_states" (
	"structure_id" text PRIMARY KEY NOT NULL,
	"corporation_id" text NOT NULL,
	"planet_id" text NOT NULL,
	"system_id" text NOT NULL,
	"type_id" text NOT NULL,
	"current_stock_volume" integer,
	"capacity_volume" integer,
	"fill_rate_per_hour" numeric(12, 4),
	"last_emptied_at" timestamp with time zone,
	"estimated_full_at" timestamp with time zone,
	"last_observed_volume" integer,
	"last_observed_at" timestamp with time zone,
	"source_sync_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"raw_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "structure_skyhook_states" (
	"structure_id" text PRIMARY KEY NOT NULL,
	"corporation_id" text NOT NULL,
	"planet_id" text NOT NULL,
	"system_id" text NOT NULL,
	"name" text,
	"owner_id" text,
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
	"raw_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "structure_sovereignty_hubs" (
	"structure_id" text PRIMARY KEY NOT NULL,
	"corporation_id" text NOT NULL,
	"system_id" text NOT NULL,
	"name" text,
	"owner_id" text,
	"type_id" text NOT NULL,
	"fuel_access_list_id" text,
	"controller_alliance_id" text,
	"reagent_bay_last_updated" timestamp with time zone,
	"reagent_bay" jsonb DEFAULT '{"lastUpdated":"","reagents":[]}'::jsonb NOT NULL,
	"resources" jsonb DEFAULT '{"power":{"allocated":0,"available":0},"workforce":{"allocated":0,"available":0}}'::jsonb NOT NULL,
	"upgrades" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"vulnerability_window_start" timestamp with time zone,
	"vulnerability_window_end" timestamp with time zone,
	"workforce_transport" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_sync_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"raw_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "structure_sovereignty_systems" (
	"system_id" text PRIMARY KEY NOT NULL,
	"corporation_id" text NOT NULL,
	"claim_type" text NOT NULL,
	"alliance_id" text,
	"corporation_claimant_id" text,
	"faction_id" text,
	"claimed_since" timestamp with time zone,
	"sovereignty_hub_structure_id" text,
	"is_capital_system" boolean,
	"vulnerability_window_start" timestamp with time zone,
	"vulnerability_window_end" timestamp with time zone,
	"activity_defense_multiplier" numeric(12, 4),
	"military_level" integer,
	"industrial_level" integer,
	"strategic_level" integer,
	"source_sync_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"raw_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "corporation_directors" DROP CONSTRAINT "corporation_directors_corporation_id_corporation_config_corporation_id_fk";
--> statement-breakpoint
ALTER TABLE "corporation_member_tracking" DROP CONSTRAINT "corporation_member_tracking_corporation_id_corporation_config_corporation_id_fk";
--> statement-breakpoint
ALTER TABLE "corporation_structures" DROP CONSTRAINT "corporation_structures_corporation_id_corporation_config_corporation_id_fk";
--> statement-breakpoint
ALTER TABLE "corporation_structure_inventory" ADD CONSTRAINT "corporation_structure_inventory_corporation_id_corporation_config_corporation_id_fk" FOREIGN KEY ("corporation_id") REFERENCES "public"."corporation_config"("corporation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporation_structure_inventory" ADD CONSTRAINT "corporation_structure_inventory_structure_id_corporation_structures_structure_id_fk" FOREIGN KEY ("structure_id") REFERENCES "public"."corporation_structures"("structure_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "structure_mining_states" ADD CONSTRAINT "structure_mining_states_structure_id_corporation_structures_structure_id_fk" FOREIGN KEY ("structure_id") REFERENCES "public"."corporation_structures"("structure_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "structure_mining_states" ADD CONSTRAINT "structure_mining_states_corporation_id_managed_corporations_corporation_id_fk" FOREIGN KEY ("corporation_id") REFERENCES "public"."managed_corporations"("corporation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "structure_skyhook_states" ADD CONSTRAINT "structure_skyhook_states_structure_id_corporation_structures_structure_id_fk" FOREIGN KEY ("structure_id") REFERENCES "public"."corporation_structures"("structure_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "structure_skyhook_states" ADD CONSTRAINT "structure_skyhook_states_corporation_id_managed_corporations_corporation_id_fk" FOREIGN KEY ("corporation_id") REFERENCES "public"."managed_corporations"("corporation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "structure_sovereignty_hubs" ADD CONSTRAINT "structure_sovereignty_hubs_structure_id_corporation_structures_structure_id_fk" FOREIGN KEY ("structure_id") REFERENCES "public"."corporation_structures"("structure_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "structure_sovereignty_hubs" ADD CONSTRAINT "structure_sovereignty_hubs_corporation_id_managed_corporations_corporation_id_fk" FOREIGN KEY ("corporation_id") REFERENCES "public"."managed_corporations"("corporation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "structure_sovereignty_systems" ADD CONSTRAINT "structure_sovereignty_systems_corporation_id_managed_corporations_corporation_id_fk" FOREIGN KEY ("corporation_id") REFERENCES "public"."managed_corporations"("corporation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "structure_sovereignty_systems" ADD CONSTRAINT "structure_sovereignty_systems_sovereignty_hub_structure_id_corporation_structures_structure_id_fk" FOREIGN KEY ("sovereignty_hub_structure_id") REFERENCES "public"."corporation_structures"("structure_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "corporation_structure_inventory_corp_structure_idx" ON "corporation_structure_inventory" USING btree ("corporation_id","structure_id");--> statement-breakpoint
CREATE INDEX "structure_mining_states_corporation_id_idx" ON "structure_mining_states" USING btree ("corporation_id");--> statement-breakpoint
CREATE INDEX "structure_mining_states_system_id_idx" ON "structure_mining_states" USING btree ("system_id");--> statement-breakpoint
CREATE INDEX "structure_mining_states_type_id_idx" ON "structure_mining_states" USING btree ("type_id");--> statement-breakpoint
CREATE INDEX "structure_mining_states_last_synced_at_idx" ON "structure_mining_states" USING btree ("last_synced_at");--> statement-breakpoint
CREATE INDEX "structure_skyhook_states_corporation_id_idx" ON "structure_skyhook_states" USING btree ("corporation_id");--> statement-breakpoint
CREATE INDEX "structure_skyhook_states_planet_id_idx" ON "structure_skyhook_states" USING btree ("planet_id");--> statement-breakpoint
CREATE INDEX "structure_skyhook_states_system_id_idx" ON "structure_skyhook_states" USING btree ("system_id");--> statement-breakpoint
CREATE INDEX "structure_skyhook_states_type_id_idx" ON "structure_skyhook_states" USING btree ("type_id");--> statement-breakpoint
CREATE INDEX "structure_skyhook_states_is_raidable_idx" ON "structure_skyhook_states" USING btree ("is_raidable");--> statement-breakpoint
CREATE INDEX "structure_skyhook_states_last_synced_at_idx" ON "structure_skyhook_states" USING btree ("last_synced_at");--> statement-breakpoint
CREATE INDEX "structure_sovereignty_hubs_corporation_id_idx" ON "structure_sovereignty_hubs" USING btree ("corporation_id");--> statement-breakpoint
CREATE INDEX "structure_sovereignty_hubs_system_id_idx" ON "structure_sovereignty_hubs" USING btree ("system_id");--> statement-breakpoint
CREATE INDEX "structure_sovereignty_hubs_type_id_idx" ON "structure_sovereignty_hubs" USING btree ("type_id");--> statement-breakpoint
CREATE INDEX "structure_sovereignty_hubs_last_synced_at_idx" ON "structure_sovereignty_hubs" USING btree ("last_synced_at");--> statement-breakpoint
CREATE INDEX "structure_sovereignty_systems_corporation_id_idx" ON "structure_sovereignty_systems" USING btree ("corporation_id");--> statement-breakpoint
CREATE INDEX "structure_sovereignty_systems_alliance_id_idx" ON "structure_sovereignty_systems" USING btree ("alliance_id");--> statement-breakpoint
CREATE INDEX "structure_sovereignty_systems_last_synced_at_idx" ON "structure_sovereignty_systems" USING btree ("last_synced_at");--> statement-breakpoint
ALTER TABLE "corporation_directors" ADD CONSTRAINT "corporation_directors_corporation_id_corporation_config_corporation_id_fk" FOREIGN KEY ("corporation_id") REFERENCES "public"."corporation_config"("corporation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporation_member_tracking" ADD CONSTRAINT "corporation_member_tracking_corporation_id_corporation_config_corporation_id_fk" FOREIGN KEY ("corporation_id") REFERENCES "public"."corporation_config"("corporation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporation_structures" ADD CONSTRAINT "corporation_structures_corporation_id_corporation_config_corporation_id_fk" FOREIGN KEY ("corporation_id") REFERENCES "public"."corporation_config"("corporation_id") ON DELETE cascade ON UPDATE no action;