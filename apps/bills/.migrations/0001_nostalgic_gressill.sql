ALTER TABLE "bill_payments" ADD COLUMN "esi_transaction_id" text NOT NULL;--> statement-breakpoint
CREATE INDEX "bill_payments_esi_transaction_id_idx" ON "bill_payments" USING btree ("esi_transaction_id");--> statement-breakpoint
ALTER TABLE "bill_payments" ADD CONSTRAINT "bill_payments_esi_transaction_id_unique" UNIQUE("esi_transaction_id");