CREATE INDEX "eve_characters_character_id_idx" ON "eve_characters" USING btree ("character_id");--> statement-breakpoint
CREATE INDEX "eve_characters_character_owner_hash_idx" ON "eve_characters" USING btree ("character_owner_hash");--> statement-breakpoint
CREATE INDEX "eve_characters_last_refresh_at_idx" ON "eve_characters" USING btree ("last_refresh_at");--> statement-breakpoint
CREATE INDEX "eve_characters_last_attempted_refresh_at_idx" ON "eve_characters" USING btree ("last_attempted_refresh_at");