ALTER TABLE "managed_corporations" ADD COLUMN "is_member_corporation" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "managed_corporations" ADD COLUMN "is_alt_corp" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "managed_corporations_corporation_id_is_member_idx" ON "managed_corporations" USING btree ("corporation_id","is_member_corporation");--> statement-breakpoint
CREATE INDEX "managed_corporations_corporation_id_is_alt_idx" ON "managed_corporations" USING btree ("corporation_id","is_alt_corp");