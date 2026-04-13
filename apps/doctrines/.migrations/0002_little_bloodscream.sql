DROP INDEX "doctrines_doctrines_category_idx";--> statement-breakpoint
ALTER TABLE "doctrines_doctrine_fittings" ADD COLUMN "fitting_category" text DEFAULT 'Uncategorized' NOT NULL;--> statement-breakpoint
ALTER TABLE "doctrines_doctrine_fittings" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "doctrines_doctrines" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "doctrines_doctrines" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "doctrines_doctrines" ADD COLUMN "updated_by" text;--> statement-breakpoint
CREATE INDEX "doctrines_doctrines_sort_order_idx" ON "doctrines_doctrines" USING btree ("sort_order");--> statement-breakpoint
ALTER TABLE "doctrines_doctrines" DROP COLUMN "category";