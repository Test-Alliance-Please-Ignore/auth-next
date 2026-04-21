CREATE TABLE "broadcast_template_targets" (
	"template_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "broadcast_template_targets_template_id_target_id_pk" PRIMARY KEY("template_id","target_id")
);
--> statement-breakpoint
ALTER TABLE "broadcast_templates" DROP CONSTRAINT "broadcast_templates_target_id_broadcast_targets_id_fk";
--> statement-breakpoint
DROP INDEX "broadcast_templates_target_id_idx";--> statement-breakpoint
ALTER TABLE "broadcast_targets" ADD COLUMN "display_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "broadcast_template_targets" ADD CONSTRAINT "broadcast_template_targets_template_id_broadcast_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."broadcast_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast_template_targets" ADD CONSTRAINT "broadcast_template_targets_target_id_broadcast_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."broadcast_targets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "broadcast_template_targets_template_id_idx" ON "broadcast_template_targets" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "broadcast_template_targets_target_id_idx" ON "broadcast_template_targets" USING btree ("target_id");--> statement-breakpoint
CREATE INDEX "broadcast_targets_display_order_idx" ON "broadcast_targets" USING btree ("display_order");--> statement-breakpoint
ALTER TABLE "broadcast_templates" DROP COLUMN "target_id";