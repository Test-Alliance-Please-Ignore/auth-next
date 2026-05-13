CREATE TABLE "srp_dismissed_losses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"killmail_id" text NOT NULL,
	"dismissed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "srp_config" ALTER COLUMN "max_loss_age_days" SET DEFAULT 30;--> statement-breakpoint
CREATE INDEX "srp_dismissed_losses_user_idx" ON "srp_dismissed_losses" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "srp_dismissed_losses_killmail_idx" ON "srp_dismissed_losses" USING btree ("killmail_id");--> statement-breakpoint
CREATE UNIQUE INDEX "srp_dismissed_losses_user_killmail_unique" ON "srp_dismissed_losses" USING btree ("user_id","killmail_id");