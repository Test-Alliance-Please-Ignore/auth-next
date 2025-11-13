CREATE TABLE "orchestrator_workflow_instances" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_type" text NOT NULL,
	"resource_id" text NOT NULL,
	"finished" boolean DEFAULT false NOT NULL,
	"failed" boolean DEFAULT false NOT NULL,
	"status" text NOT NULL,
	"error_message" text,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "orchestrator_workflow_instances_finished_idx" ON "orchestrator_workflow_instances" USING btree ("finished");--> statement-breakpoint
CREATE INDEX "orchestrator_workflow_instances_failed_idx" ON "orchestrator_workflow_instances" USING btree ("failed");--> statement-breakpoint
CREATE INDEX "orchestrator_workflow_instances_workflow_type_idx" ON "orchestrator_workflow_instances" USING btree ("workflow_type");--> statement-breakpoint
CREATE INDEX "orchestrator_workflow_instances_resource_id_idx" ON "orchestrator_workflow_instances" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "orchestrator_workflow_instances_status_idx" ON "orchestrator_workflow_instances" USING btree ("status");--> statement-breakpoint
CREATE INDEX "orchestrator_workflow_instances_finished_at_idx" ON "orchestrator_workflow_instances" USING btree ("finished_at");--> statement-breakpoint
CREATE INDEX "orchestrator_workflow_instances_workflow_type_resource_id_idx" ON "orchestrator_workflow_instances" USING btree ("workflow_type","resource_id");