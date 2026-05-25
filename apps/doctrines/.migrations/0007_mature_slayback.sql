CREATE TABLE "doctrines_deleted_doctrine_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doctrine_id" uuid NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_by" text,
	"snapshot" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "doctrines_deleted_fitting_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fitting_id" uuid NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_by" text,
	"snapshot" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "doctrines_doctrines" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "doctrines_doctrines" ADD COLUMN "deleted_by" text;--> statement-breakpoint
ALTER TABLE "doctrines_fittings" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "doctrines_fittings" ADD COLUMN "deleted_by" text;--> statement-breakpoint
CREATE INDEX "doctrines_deleted_doctrine_snapshots_doctrine_id_idx" ON "doctrines_deleted_doctrine_snapshots" USING btree ("doctrine_id");--> statement-breakpoint
CREATE INDEX "doctrines_deleted_doctrine_snapshots_deleted_at_idx" ON "doctrines_deleted_doctrine_snapshots" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "doctrines_deleted_fitting_snapshots_fitting_id_idx" ON "doctrines_deleted_fitting_snapshots" USING btree ("fitting_id");--> statement-breakpoint
CREATE INDEX "doctrines_deleted_fitting_snapshots_deleted_at_idx" ON "doctrines_deleted_fitting_snapshots" USING btree ("deleted_at");