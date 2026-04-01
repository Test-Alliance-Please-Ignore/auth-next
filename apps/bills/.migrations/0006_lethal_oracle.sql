ALTER TABLE "bills" ADD COLUMN "group_bill_id" uuid;--> statement-breakpoint
CREATE INDEX "bills_group_bill_id_idx" ON "bills" USING btree ("group_bill_id");