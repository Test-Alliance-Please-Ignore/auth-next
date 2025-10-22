ALTER TABLE "corporation_directors" DROP CONSTRAINT "corporation_directors_corp_healthy_idx";--> statement-breakpoint
CREATE INDEX "corporation_directors_corp_healthy_idx" ON "corporation_directors" USING btree ("corporation_id","is_healthy");--> statement-breakpoint
CREATE INDEX "corporation_directors_last_used_idx" ON "corporation_directors" USING btree ("corporation_id","last_used");