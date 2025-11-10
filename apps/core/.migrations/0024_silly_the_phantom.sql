ALTER TABLE "dkp_transactions" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "dkp_transactions" ADD CONSTRAINT "dkp_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dkp_transactions_user_earned_idx" ON "dkp_transactions" USING btree ("user_id","earned_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "dkp_transactions_user_source_idx" ON "dkp_transactions" USING btree ("user_id","source_type");