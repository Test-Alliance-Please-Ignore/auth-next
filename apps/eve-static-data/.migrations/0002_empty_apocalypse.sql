-- Drop foreign key constraints
ALTER TABLE "skill_groups" DROP CONSTRAINT IF EXISTS "skill_groups_category_id_skill_categories_id_fk";--> statement-breakpoint
ALTER TABLE "skills" DROP CONSTRAINT IF EXISTS "skills_group_id_skill_groups_id_fk";--> statement-breakpoint
ALTER TABLE "skill_attributes" DROP CONSTRAINT IF EXISTS "skill_attributes_skill_id_skills_id_fk";--> statement-breakpoint
ALTER TABLE "skill_requirements" DROP CONSTRAINT IF EXISTS "skill_requirements_skill_id_skills_id_fk";--> statement-breakpoint
ALTER TABLE "skill_requirements" DROP CONSTRAINT IF EXISTS "skill_requirements_required_skill_id_skills_id_fk";--> statement-breakpoint

-- Alter all ID columns to text
ALTER TABLE "skill_categories" ALTER COLUMN "id" SET DATA TYPE text;--> statement-breakpoint

ALTER TABLE "skill_groups" ALTER COLUMN "id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "skill_groups" ALTER COLUMN "category_id" SET DATA TYPE text;--> statement-breakpoint

ALTER TABLE "skills" ALTER COLUMN "id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "skills" ALTER COLUMN "group_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "skills" ALTER COLUMN "primary_attribute" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "skills" ALTER COLUMN "secondary_attribute" SET DATA TYPE text;--> statement-breakpoint

ALTER TABLE "skill_attributes" ALTER COLUMN "skill_id" SET DATA TYPE text;--> statement-breakpoint

ALTER TABLE "skill_requirements" ALTER COLUMN "skill_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "skill_requirements" ALTER COLUMN "required_skill_id" SET DATA TYPE text;--> statement-breakpoint

ALTER TABLE "corporations" ALTER COLUMN "corporation_id" SET DATA TYPE text;--> statement-breakpoint

ALTER TABLE "alliances" ALTER COLUMN "alliance_id" SET DATA TYPE text;--> statement-breakpoint

-- Recreate foreign key constraints
ALTER TABLE "skill_groups" ADD CONSTRAINT "skill_groups_category_id_skill_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "skill_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_group_id_skill_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "skill_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_attributes" ADD CONSTRAINT "skill_attributes_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_requirements" ADD CONSTRAINT "skill_requirements_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_requirements" ADD CONSTRAINT "skill_requirements_required_skill_id_skills_id_fk" FOREIGN KEY ("required_skill_id") REFERENCES "skills"("id") ON DELETE no action ON UPDATE no action;
