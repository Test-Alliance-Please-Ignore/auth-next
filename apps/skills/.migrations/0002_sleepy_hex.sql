CREATE INDEX "idx_category_mappings_plan" ON "do_skill_plan_category_mappings" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "idx_category_mappings_category" ON "do_skill_plan_category_mappings" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "idx_skill_plan_skills_plan" ON "do_skill_plan_skills" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "idx_skill_plans_published" ON "do_skill_plans" USING btree ("is_published");--> statement-breakpoint
CREATE INDEX "idx_skill_plans_maintainer" ON "do_skill_plans" USING btree ("maintainer_id");--> statement-breakpoint
CREATE INDEX "idx_skill_plans_owner" ON "do_skill_plans" USING btree ("owner_character_id");--> statement-breakpoint
CREATE INDEX "idx_skill_plans_updated" ON "do_skill_plans" USING btree ("updated_at");