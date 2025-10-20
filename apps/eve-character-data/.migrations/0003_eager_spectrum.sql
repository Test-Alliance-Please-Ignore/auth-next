CREATE TABLE "character_market_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"character_id" integer NOT NULL,
	"order_id" bigint NOT NULL,
	"type_id" integer NOT NULL,
	"location_id" bigint NOT NULL,
	"is_buy_order" boolean NOT NULL,
	"price" text NOT NULL,
	"volume_total" integer NOT NULL,
	"volume_remain" integer NOT NULL,
	"issued" timestamp with time zone NOT NULL,
	"state" text NOT NULL,
	"min_volume" integer NOT NULL,
	"range" text NOT NULL,
	"duration" integer NOT NULL,
	"escrow" text,
	"region_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "character_market_orders_character_id_order_id_unique" UNIQUE("character_id","order_id")
);
--> statement-breakpoint
CREATE TABLE "character_market_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"character_id" integer NOT NULL,
	"transaction_id" bigint NOT NULL,
	"date" timestamp with time zone NOT NULL,
	"type_id" integer NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price" text NOT NULL,
	"client_id" integer NOT NULL,
	"location_id" bigint NOT NULL,
	"is_buy" boolean NOT NULL,
	"is_personal" boolean NOT NULL,
	"journal_ref_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "character_market_transactions_character_id_transaction_id_unique" UNIQUE("character_id","transaction_id")
);
--> statement-breakpoint
CREATE TABLE "character_wallet_journal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"character_id" integer NOT NULL,
	"journal_id" bigint NOT NULL,
	"date" timestamp with time zone NOT NULL,
	"ref_type" text NOT NULL,
	"amount" text NOT NULL,
	"balance" text NOT NULL,
	"description" text NOT NULL,
	"first_party_id" integer,
	"second_party_id" integer,
	"reason" text,
	"tax" text,
	"tax_receiver_id" integer,
	"context_id" bigint,
	"context_id_type" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "character_wallet_journal_character_id_journal_id_unique" UNIQUE("character_id","journal_id")
);
--> statement-breakpoint
ALTER TABLE "character_market_orders" ADD CONSTRAINT "character_market_orders_character_id_character_public_info_character_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."character_public_info"("character_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_market_transactions" ADD CONSTRAINT "character_market_transactions_character_id_character_public_info_character_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."character_public_info"("character_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_wallet_journal" ADD CONSTRAINT "character_wallet_journal_character_id_character_public_info_character_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."character_public_info"("character_id") ON DELETE no action ON UPDATE no action;