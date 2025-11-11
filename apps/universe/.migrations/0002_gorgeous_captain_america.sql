CREATE TABLE "universe_eve_alliance_ids" (
	"alliance_id" text PRIMARY KEY NOT NULL,
	"alliance_name" text NOT NULL,
	"ticker" text
);
--> statement-breakpoint
CREATE TABLE "universe_eve_character_ids" (
	"character_id" text PRIMARY KEY NOT NULL,
	"character_name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "universe_eve_corporation_ids" (
	"corporation_id" text PRIMARY KEY NOT NULL,
	"corporation_name" text NOT NULL,
	"ticker" text
);
--> statement-breakpoint
CREATE INDEX "universe_eve_alliance_ids_alliance_id_idx" ON "universe_eve_alliance_ids" USING btree ("alliance_id");--> statement-breakpoint
CREATE INDEX "universe_eve_alliance_ids_alliance_name_idx" ON "universe_eve_alliance_ids" USING btree ("alliance_name");--> statement-breakpoint
CREATE INDEX "universe_eve_alliance_ids_ticker_idx" ON "universe_eve_alliance_ids" USING btree ("ticker");--> statement-breakpoint
CREATE INDEX "universe_eve_character_ids_character_id_idx" ON "universe_eve_character_ids" USING btree ("character_id");--> statement-breakpoint
CREATE INDEX "universe_eve_character_ids_character_name_idx" ON "universe_eve_character_ids" USING btree ("character_name");--> statement-breakpoint
CREATE INDEX "universe_eve_corporation_ids_corporation_id_idx" ON "universe_eve_corporation_ids" USING btree ("corporation_id");--> statement-breakpoint
CREATE INDEX "universe_eve_corporation_ids_corporation_name_idx" ON "universe_eve_corporation_ids" USING btree ("corporation_name");--> statement-breakpoint
CREATE INDEX "universe_eve_corporation_ids_ticker_idx" ON "universe_eve_corporation_ids" USING btree ("ticker");