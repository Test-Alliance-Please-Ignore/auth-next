CREATE TABLE "character_corporation_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"corporation_id" integer NOT NULL,
	"character_id" integer NOT NULL,
	"roles" jsonb NOT NULL,
	"roles_at_hq" jsonb,
	"roles_at_base" jsonb,
	"roles_at_other" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "character_corporation_roles_corporation_id_character_id_unique" UNIQUE("corporation_id","character_id")
);
--> statement-breakpoint
CREATE TABLE "corporation_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"corporation_id" integer NOT NULL,
	"item_id" bigint NOT NULL,
	"is_singleton" boolean NOT NULL,
	"location_flag" text NOT NULL,
	"location_id" bigint NOT NULL,
	"location_type" text NOT NULL,
	"quantity" integer NOT NULL,
	"type_id" integer NOT NULL,
	"is_blueprint_copy" boolean,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "corporation_assets_corporation_id_item_id_unique" UNIQUE("corporation_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "corporation_config" (
	"corporation_id" integer PRIMARY KEY NOT NULL,
	"character_id" integer NOT NULL,
	"character_name" text NOT NULL,
	"last_verified" timestamp with time zone,
	"is_verified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "corporation_contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"corporation_id" integer NOT NULL,
	"contract_id" integer NOT NULL,
	"acceptor_id" integer,
	"assignee_id" integer NOT NULL,
	"availability" text NOT NULL,
	"buyout" text,
	"collateral" text,
	"date_accepted" timestamp with time zone,
	"date_completed" timestamp with time zone,
	"date_expired" timestamp with time zone NOT NULL,
	"date_issued" timestamp with time zone NOT NULL,
	"days_to_complete" integer,
	"end_location_id" bigint,
	"for_corporation" boolean NOT NULL,
	"issuer_corporation_id" integer NOT NULL,
	"issuer_id" integer NOT NULL,
	"price" text,
	"reward" text,
	"start_location_id" bigint,
	"status" text NOT NULL,
	"title" text,
	"type" text NOT NULL,
	"volume" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "corporation_contracts_corporation_id_contract_id_unique" UNIQUE("corporation_id","contract_id")
);
--> statement-breakpoint
CREATE TABLE "corporation_industry_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"corporation_id" integer NOT NULL,
	"job_id" integer NOT NULL,
	"installer_id" integer NOT NULL,
	"facility_id" bigint NOT NULL,
	"location_id" bigint NOT NULL,
	"activity_id" integer NOT NULL,
	"blueprint_id" bigint NOT NULL,
	"blueprint_type_id" integer NOT NULL,
	"blueprint_location_id" bigint NOT NULL,
	"output_location_id" bigint NOT NULL,
	"runs" integer NOT NULL,
	"cost" text,
	"licensed_runs" integer,
	"probability" text,
	"product_type_id" integer,
	"status" text NOT NULL,
	"duration" integer NOT NULL,
	"start_date" timestamp with time zone NOT NULL,
	"end_date" timestamp with time zone NOT NULL,
	"pause_date" timestamp with time zone,
	"completed_date" timestamp with time zone,
	"completed_character_id" integer,
	"successful_runs" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "corporation_industry_jobs_corporation_id_job_id_unique" UNIQUE("corporation_id","job_id")
);
--> statement-breakpoint
CREATE TABLE "corporation_killmails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"corporation_id" integer NOT NULL,
	"killmail_id" integer NOT NULL,
	"killmail_hash" text NOT NULL,
	"killmail_time" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "corporation_killmails_corporation_id_killmail_id_unique" UNIQUE("corporation_id","killmail_id")
);
--> statement-breakpoint
CREATE TABLE "corporation_member_tracking" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"corporation_id" integer NOT NULL,
	"character_id" integer NOT NULL,
	"base_id" integer,
	"location_id" bigint,
	"logoff_date" timestamp with time zone,
	"logon_date" timestamp with time zone,
	"ship_type_id" integer,
	"start_date" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "corporation_member_tracking_corporation_id_character_id_unique" UNIQUE("corporation_id","character_id")
);
--> statement-breakpoint
CREATE TABLE "corporation_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"corporation_id" integer NOT NULL,
	"character_id" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "corporation_members_corporation_id_character_id_unique" UNIQUE("corporation_id","character_id")
);
--> statement-breakpoint
CREATE TABLE "corporation_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"corporation_id" integer NOT NULL,
	"order_id" bigint NOT NULL,
	"duration" integer NOT NULL,
	"escrow" text,
	"is_buy_order" boolean NOT NULL,
	"issued" timestamp with time zone NOT NULL,
	"issued_by" integer NOT NULL,
	"location_id" bigint NOT NULL,
	"min_volume" integer,
	"price" text NOT NULL,
	"range" text NOT NULL,
	"region_id" integer NOT NULL,
	"type_id" integer NOT NULL,
	"volume_remain" integer NOT NULL,
	"volume_total" integer NOT NULL,
	"wallet_division" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "corporation_orders_corporation_id_order_id_unique" UNIQUE("corporation_id","order_id")
);
--> statement-breakpoint
CREATE TABLE "corporation_public_info" (
	"corporation_id" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"ticker" text NOT NULL,
	"ceo_id" integer NOT NULL,
	"creator_id" integer NOT NULL,
	"date_founded" timestamp with time zone,
	"description" text,
	"home_station_id" integer,
	"member_count" integer NOT NULL,
	"shares" bigint,
	"tax_rate" text NOT NULL,
	"url" text,
	"alliance_id" integer,
	"faction_id" integer,
	"war_eligible" boolean,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "corporation_structures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"corporation_id" integer NOT NULL,
	"structure_id" bigint NOT NULL,
	"type_id" integer NOT NULL,
	"system_id" integer NOT NULL,
	"profile_id" integer NOT NULL,
	"fuel_expires" timestamp with time zone,
	"next_reinforce_apply" timestamp with time zone,
	"next_reinforce_hour" integer,
	"reinforce_hour" integer,
	"state" text NOT NULL,
	"state_timer_end" timestamp with time zone,
	"state_timer_start" timestamp with time zone,
	"unanchors_at" timestamp with time zone,
	"services" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "corporation_structures_corporation_id_structure_id_unique" UNIQUE("corporation_id","structure_id")
);
--> statement-breakpoint
CREATE TABLE "corporation_wallet_journal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"corporation_id" integer NOT NULL,
	"division" integer NOT NULL,
	"journal_id" bigint NOT NULL,
	"amount" text,
	"balance" text,
	"context_id" bigint,
	"context_id_type" text,
	"date" timestamp with time zone NOT NULL,
	"description" text NOT NULL,
	"first_party_id" integer,
	"reason" text,
	"ref_type" text NOT NULL,
	"second_party_id" integer,
	"tax" text,
	"tax_receiver_id" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "corporation_wallet_journal_corporation_id_division_journal_id_unique" UNIQUE("corporation_id","division","journal_id")
);
--> statement-breakpoint
CREATE TABLE "corporation_wallet_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"corporation_id" integer NOT NULL,
	"division" integer NOT NULL,
	"transaction_id" bigint NOT NULL,
	"client_id" integer NOT NULL,
	"date" timestamp with time zone NOT NULL,
	"is_buy" boolean NOT NULL,
	"is_personal" boolean NOT NULL,
	"journal_ref_id" bigint NOT NULL,
	"location_id" bigint NOT NULL,
	"quantity" integer NOT NULL,
	"type_id" integer NOT NULL,
	"unit_price" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "corporation_wallet_transactions_corporation_id_division_transaction_id_unique" UNIQUE("corporation_id","division","transaction_id")
);
--> statement-breakpoint
CREATE TABLE "corporation_wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"corporation_id" integer NOT NULL,
	"division" integer NOT NULL,
	"balance" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "corporation_wallets_corporation_id_division_unique" UNIQUE("corporation_id","division")
);
--> statement-breakpoint
ALTER TABLE "character_corporation_roles" ADD CONSTRAINT "character_corporation_roles_corporation_id_corporation_config_corporation_id_fk" FOREIGN KEY ("corporation_id") REFERENCES "public"."corporation_config"("corporation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporation_assets" ADD CONSTRAINT "corporation_assets_corporation_id_corporation_config_corporation_id_fk" FOREIGN KEY ("corporation_id") REFERENCES "public"."corporation_config"("corporation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporation_contracts" ADD CONSTRAINT "corporation_contracts_corporation_id_corporation_config_corporation_id_fk" FOREIGN KEY ("corporation_id") REFERENCES "public"."corporation_config"("corporation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporation_industry_jobs" ADD CONSTRAINT "corporation_industry_jobs_corporation_id_corporation_config_corporation_id_fk" FOREIGN KEY ("corporation_id") REFERENCES "public"."corporation_config"("corporation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporation_killmails" ADD CONSTRAINT "corporation_killmails_corporation_id_corporation_config_corporation_id_fk" FOREIGN KEY ("corporation_id") REFERENCES "public"."corporation_config"("corporation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporation_member_tracking" ADD CONSTRAINT "corporation_member_tracking_corporation_id_corporation_config_corporation_id_fk" FOREIGN KEY ("corporation_id") REFERENCES "public"."corporation_config"("corporation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporation_members" ADD CONSTRAINT "corporation_members_corporation_id_corporation_config_corporation_id_fk" FOREIGN KEY ("corporation_id") REFERENCES "public"."corporation_config"("corporation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporation_orders" ADD CONSTRAINT "corporation_orders_corporation_id_corporation_config_corporation_id_fk" FOREIGN KEY ("corporation_id") REFERENCES "public"."corporation_config"("corporation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporation_structures" ADD CONSTRAINT "corporation_structures_corporation_id_corporation_config_corporation_id_fk" FOREIGN KEY ("corporation_id") REFERENCES "public"."corporation_config"("corporation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporation_wallet_journal" ADD CONSTRAINT "corporation_wallet_journal_corporation_id_corporation_config_corporation_id_fk" FOREIGN KEY ("corporation_id") REFERENCES "public"."corporation_config"("corporation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporation_wallet_transactions" ADD CONSTRAINT "corporation_wallet_transactions_corporation_id_corporation_config_corporation_id_fk" FOREIGN KEY ("corporation_id") REFERENCES "public"."corporation_config"("corporation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporation_wallets" ADD CONSTRAINT "corporation_wallets_corporation_id_corporation_config_corporation_id_fk" FOREIGN KEY ("corporation_id") REFERENCES "public"."corporation_config"("corporation_id") ON DELETE no action ON UPDATE no action;