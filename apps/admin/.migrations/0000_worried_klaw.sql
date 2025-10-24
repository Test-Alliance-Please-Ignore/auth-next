CREATE TABLE "admin_operations_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_user_id" uuid NOT NULL,
	"action" text NOT NULL,
	"target_user_id" uuid,
	"target_character_id" text,
	"metadata" jsonb,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"ip" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE INDEX "admin_operations_log_admin_user_id_idx" ON "admin_operations_log" USING btree ("admin_user_id");--> statement-breakpoint
CREATE INDEX "admin_operations_log_timestamp_idx" ON "admin_operations_log" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "admin_operations_log_action_timestamp_idx" ON "admin_operations_log" USING btree ("action","timestamp");--> statement-breakpoint
CREATE INDEX "admin_operations_log_target_user_id_idx" ON "admin_operations_log" USING btree ("target_user_id");--> statement-breakpoint
CREATE INDEX "admin_operations_log_target_character_id_idx" ON "admin_operations_log" USING btree ("target_character_id");