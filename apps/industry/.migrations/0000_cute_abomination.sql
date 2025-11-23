CREATE TABLE "industry_order_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"previous_status" text NOT NULL,
	"new_status" text NOT NULL,
	"actor_entity_id" text NOT NULL,
	"actor_entity_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "industry_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"order_type" text NOT NULL,
	"issuer_entity_id" text NOT NULL,
	"issuer_entity_type" text NOT NULL,
	"assignee_entity_id" text,
	"assignee_entity_type" text,
	"eve_contract_id" text,
	"delivery_location_id" text,
	"reward_amount" text NOT NULL,
	"collateral_amount" text DEFAULT '0',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"refunded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "industry_provider_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" uuid NOT NULL,
	"contact_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "industry_provider_services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" uuid NOT NULL,
	"service_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'inactive' NOT NULL,
	CONSTRAINT "industry_provider_services_provider_id_service_type_unique" UNIQUE("provider_id","service_type")
);
--> statement-breakpoint
CREATE TABLE "industry_service_providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"owner_entity_id" text NOT NULL,
	"owner_entity_type" text NOT NULL,
	"accepting_orders" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "industry_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"from_entity_id" text NOT NULL,
	"from_entity_type" text NOT NULL,
	"to_entity_id" text NOT NULL,
	"to_entity_type" text NOT NULL,
	"amount" text NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "industry_order_status_history" ADD CONSTRAINT "industry_order_status_history_order_id_industry_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."industry_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "industry_provider_contacts" ADD CONSTRAINT "industry_provider_contacts_provider_id_industry_service_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."industry_service_providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "industry_provider_services" ADD CONSTRAINT "industry_provider_services_provider_id_industry_service_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."industry_service_providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "industry_transactions" ADD CONSTRAINT "industry_transactions_order_id_industry_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."industry_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "industry_order_status_history_order_id_idx" ON "industry_order_status_history" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "industry_order_status_history_actor_entity_id_idx" ON "industry_order_status_history" USING btree ("actor_entity_id");--> statement-breakpoint
CREATE INDEX "industry_order_status_history_actor_entity_type_actor_entity_id_idx" ON "industry_order_status_history" USING btree ("actor_entity_type","actor_entity_id");--> statement-breakpoint
CREATE INDEX "industry_order_status_history_order_id_created_at_idx" ON "industry_order_status_history" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE INDEX "industry_order_status_history_created_at_idx" ON "industry_order_status_history" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "industry_orders_status_idx" ON "industry_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "industry_orders_order_type_idx" ON "industry_orders" USING btree ("order_type");--> statement-breakpoint
CREATE INDEX "industry_orders_issuer_entity_id_idx" ON "industry_orders" USING btree ("issuer_entity_id");--> statement-breakpoint
CREATE INDEX "industry_orders_issuer_entity_type_issuer_entity_id_idx" ON "industry_orders" USING btree ("issuer_entity_type","issuer_entity_id");--> statement-breakpoint
CREATE INDEX "industry_orders_assignee_entity_id_idx" ON "industry_orders" USING btree ("assignee_entity_id");--> statement-breakpoint
CREATE INDEX "industry_orders_assignee_entity_type_assignee_entity_id_idx" ON "industry_orders" USING btree ("assignee_entity_type","assignee_entity_id");--> statement-breakpoint
CREATE INDEX "industry_orders_eve_contract_id_idx" ON "industry_orders" USING btree ("eve_contract_id");--> statement-breakpoint
CREATE INDEX "industry_orders_delivery_location_id_idx" ON "industry_orders" USING btree ("delivery_location_id");--> statement-breakpoint
CREATE INDEX "industry_orders_status_created_at_idx" ON "industry_orders" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "industry_orders_status_order_type_idx" ON "industry_orders" USING btree ("status","order_type");--> statement-breakpoint
CREATE INDEX "industry_orders_created_at_idx" ON "industry_orders" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "industry_orders_updated_at_idx" ON "industry_orders" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "industry_orders_expires_at_idx" ON "industry_orders" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "industry_orders_accepted_at_idx" ON "industry_orders" USING btree ("accepted_at");--> statement-breakpoint
CREATE INDEX "industry_orders_completed_at_idx" ON "industry_orders" USING btree ("completed_at");--> statement-breakpoint
CREATE INDEX "industry_orders_cancelled_at_idx" ON "industry_orders" USING btree ("cancelled_at");--> statement-breakpoint
CREATE INDEX "industry_orders_rejected_at_idx" ON "industry_orders" USING btree ("rejected_at");--> statement-breakpoint
CREATE INDEX "industry_orders_refunded_at_idx" ON "industry_orders" USING btree ("refunded_at");--> statement-breakpoint
CREATE INDEX "industry_provider_contacts_provider_id_idx" ON "industry_provider_contacts" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "industry_provider_contacts_contact_type_idx" ON "industry_provider_contacts" USING btree ("contact_type");--> statement-breakpoint
CREATE INDEX "industry_provider_contacts_provider_id_contact_type_idx" ON "industry_provider_contacts" USING btree ("provider_id","contact_type");--> statement-breakpoint
CREATE INDEX "industry_provider_contacts_created_at_idx" ON "industry_provider_contacts" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "industry_provider_contacts_updated_at_idx" ON "industry_provider_contacts" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "industry_provider_services_provider_id_idx" ON "industry_provider_services" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "industry_provider_services_service_type_idx" ON "industry_provider_services" USING btree ("service_type");--> statement-breakpoint
CREATE INDEX "industry_provider_services_status_idx" ON "industry_provider_services" USING btree ("status");--> statement-breakpoint
CREATE INDEX "industry_provider_services_created_at_idx" ON "industry_provider_services" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "industry_provider_services_updated_at_idx" ON "industry_provider_services" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "industry_provider_services_provider_id_status_idx" ON "industry_provider_services" USING btree ("provider_id","status");--> statement-breakpoint
CREATE INDEX "industry_provider_services_service_type_status_idx" ON "industry_provider_services" USING btree ("service_type","status");--> statement-breakpoint
CREATE INDEX "industry_service_providers_created_at_idx" ON "industry_service_providers" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "industry_service_providers_updated_at_idx" ON "industry_service_providers" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "industry_service_providers_owner_entity_id_idx" ON "industry_service_providers" USING btree ("owner_entity_id");--> statement-breakpoint
CREATE INDEX "industry_service_providers_owner_entity_type_owner_entity_id_idx" ON "industry_service_providers" USING btree ("owner_entity_type","owner_entity_id");--> statement-breakpoint
CREATE INDEX "industry_service_providers_accepting_orders_idx" ON "industry_service_providers" USING btree ("accepting_orders");--> statement-breakpoint
CREATE INDEX "industry_transactions_order_id_idx" ON "industry_transactions" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "industry_transactions_from_entity_id_idx" ON "industry_transactions" USING btree ("from_entity_id");--> statement-breakpoint
CREATE INDEX "industry_transactions_from_entity_type_from_entity_id_idx" ON "industry_transactions" USING btree ("from_entity_type","from_entity_id");--> statement-breakpoint
CREATE INDEX "industry_transactions_to_entity_id_idx" ON "industry_transactions" USING btree ("to_entity_id");--> statement-breakpoint
CREATE INDEX "industry_transactions_to_entity_type_idx" ON "industry_transactions" USING btree ("to_entity_type");--> statement-breakpoint
CREATE INDEX "industry_transactions_to_entity_type_to_entity_id_idx" ON "industry_transactions" USING btree ("to_entity_type","to_entity_id");--> statement-breakpoint
CREATE INDEX "industry_transactions_transaction_type_idx" ON "industry_transactions" USING btree ("type");--> statement-breakpoint
CREATE INDEX "industry_transactions_transaction_status_idx" ON "industry_transactions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "industry_transactions_status_created_at_idx" ON "industry_transactions" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "industry_transactions_order_id_status_idx" ON "industry_transactions" USING btree ("order_id","status");--> statement-breakpoint
CREATE INDEX "industry_transactions_created_at_idx" ON "industry_transactions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "industry_transactions_updated_at_idx" ON "industry_transactions" USING btree ("updated_at");