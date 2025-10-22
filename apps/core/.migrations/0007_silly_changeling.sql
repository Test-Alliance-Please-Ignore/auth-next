CREATE TABLE "managed_corporations" (
	"corporation_id" bigint PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"ticker" varchar(10) NOT NULL,
	"assigned_character_id" bigint,
	"assigned_character_name" varchar(255),
	"is_active" boolean DEFAULT true NOT NULL,
	"last_sync" timestamp with time zone,
	"last_verified" timestamp with time zone,
	"is_verified" boolean DEFAULT false NOT NULL,
	"configured_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "managed_corporations" ADD CONSTRAINT "managed_corporations_configured_by_users_id_fk" FOREIGN KEY ("configured_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "managed_corporations_name_idx" ON "managed_corporations" USING btree ("name");--> statement-breakpoint
CREATE INDEX "managed_corporations_ticker_idx" ON "managed_corporations" USING btree ("ticker");--> statement-breakpoint
CREATE INDEX "managed_corporations_assigned_character_id_idx" ON "managed_corporations" USING btree ("assigned_character_id");--> statement-breakpoint
CREATE INDEX "managed_corporations_is_active_idx" ON "managed_corporations" USING btree ("is_active");