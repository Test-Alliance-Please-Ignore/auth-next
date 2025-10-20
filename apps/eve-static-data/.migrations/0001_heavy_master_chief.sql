CREATE TABLE "alliances" (
	"alliance_id" integer,
	"alliance_name" text NOT NULL,
	"ticker" text NOT NULL,
	CONSTRAINT "alliances_alliance_id_alliance_name_ticker_unique" UNIQUE("alliance_id","alliance_name","ticker")
);
--> statement-breakpoint
CREATE TABLE "corporations" (
	"corporation_id" integer,
	"corporation_name" text NOT NULL,
	"ticker" text NOT NULL,
	CONSTRAINT "corporations_corporation_id_corporation_name_ticker_unique" UNIQUE("corporation_id","corporation_name","ticker")
);
