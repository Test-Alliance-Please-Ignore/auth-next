CREATE TABLE "evesso_oauth_states" (
	"state" varchar(255) PRIMARY KEY NOT NULL,
	"session_id" varchar(64),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evesso_tokens" (
	"character_id" integer PRIMARY KEY NOT NULL,
	"character_name" varchar(255) NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"scopes" text NOT NULL,
	"proxy_token" varchar(64) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "evesso_tokens_proxy_token_unique" UNIQUE("proxy_token")
);
--> statement-breakpoint
CREATE INDEX "evesso_oauth_states_expires_idx" ON "evesso_oauth_states" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "evesso_oauth_states_session_idx" ON "evesso_oauth_states" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "evesso_tokens_proxy_idx" ON "evesso_tokens" USING btree ("proxy_token");--> statement-breakpoint
CREATE INDEX "evesso_tokens_expires_idx" ON "evesso_tokens" USING btree ("expires_at");