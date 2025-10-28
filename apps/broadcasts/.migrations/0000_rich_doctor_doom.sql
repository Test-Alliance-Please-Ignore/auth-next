CREATE TYPE "public"."broadcast_status" AS ENUM('draft', 'scheduled', 'sending', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."delivery_status" AS ENUM('pending', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."target_type" AS ENUM('discord_channel');--> statement-breakpoint
CREATE TABLE "broadcast_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"broadcast_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"status" "delivery_status" DEFAULT 'pending' NOT NULL,
	"discord_message_id" varchar(255),
	"error_message" text,
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "broadcast_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"type" "target_type" NOT NULL,
	"group_id" uuid NOT NULL,
	"config" jsonb NOT NULL,
	"created_by" varchar(255) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "broadcast_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"target_type" varchar(100) NOT NULL,
	"group_id" uuid NOT NULL,
	"field_schema" jsonb NOT NULL,
	"message_template" text NOT NULL,
	"created_by" varchar(255) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "broadcasts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid,
	"target_id" uuid NOT NULL,
	"title" varchar(255) NOT NULL,
	"content" jsonb NOT NULL,
	"status" "broadcast_status" DEFAULT 'draft' NOT NULL,
	"scheduled_for" timestamp,
	"sent_at" timestamp,
	"error_message" text,
	"group_id" uuid NOT NULL,
	"created_by" varchar(255) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "broadcast_deliveries" ADD CONSTRAINT "broadcast_deliveries_broadcast_id_broadcasts_id_fk" FOREIGN KEY ("broadcast_id") REFERENCES "public"."broadcasts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast_deliveries" ADD CONSTRAINT "broadcast_deliveries_target_id_broadcast_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."broadcast_targets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_template_id_broadcast_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."broadcast_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_target_id_broadcast_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."broadcast_targets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "broadcast_deliveries_broadcast_id_idx" ON "broadcast_deliveries" USING btree ("broadcast_id");--> statement-breakpoint
CREATE INDEX "broadcast_deliveries_status_idx" ON "broadcast_deliveries" USING btree ("status");--> statement-breakpoint
CREATE INDEX "broadcast_targets_group_id_idx" ON "broadcast_targets" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "broadcast_targets_type_idx" ON "broadcast_targets" USING btree ("type");--> statement-breakpoint
CREATE INDEX "broadcast_templates_group_id_idx" ON "broadcast_templates" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "broadcast_templates_target_type_idx" ON "broadcast_templates" USING btree ("target_type");--> statement-breakpoint
CREATE INDEX "broadcasts_group_id_idx" ON "broadcasts" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "broadcasts_status_idx" ON "broadcasts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "broadcasts_created_by_idx" ON "broadcasts" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "broadcasts_scheduled_for_idx" ON "broadcasts" USING btree ("scheduled_for");--> statement-breakpoint
CREATE INDEX "broadcasts_target_id_idx" ON "broadcasts" USING btree ("target_id");