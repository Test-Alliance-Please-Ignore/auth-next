ALTER TABLE "user_characters" ADD COLUMN "corporation_id" text;--> statement-breakpoint
ALTER TABLE "user_characters" ADD COLUMN "corporation_name" varchar(255);--> statement-breakpoint
ALTER TABLE "user_characters" ADD COLUMN "alliance_id" text;--> statement-breakpoint
ALTER TABLE "user_characters" ADD COLUMN "alliance_name" varchar(255);--> statement-breakpoint
CREATE INDEX "user_characters_corporation_id_idx" ON "user_characters" USING btree ("corporation_id");--> statement-breakpoint
CREATE INDEX "user_characters_alliance_id_idx" ON "user_characters" USING btree ("alliance_id");--> statement-breakpoint
CREATE INDEX "user_characters_corporation_name_idx" ON "user_characters" USING btree ("corporation_name");--> statement-breakpoint
CREATE INDEX "user_characters_alliance_name_idx" ON "user_characters" USING btree ("alliance_name");