CREATE TABLE "do_skill_plan_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"icon" text,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "do_skill_plan_categories_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "do_skill_plan_category_mappings" (
	"plan_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "do_skill_plan_category_mappings_plan_id_category_id_unique" UNIQUE("plan_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "do_skill_plan_skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"skill_id" text NOT NULL,
	"required_level" integer NOT NULL,
	"recommended_level" integer NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "do_skill_plan_skills_plan_id_skill_id_unique" UNIQUE("plan_id","skill_id")
);
--> statement-breakpoint
CREATE TABLE "do_skill_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"is_published" boolean DEFAULT false NOT NULL,
	"maintainer_id" text,
	"owner_character_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "do_skill_plan_category_mappings" ADD CONSTRAINT "do_skill_plan_category_mappings_plan_id_do_skill_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."do_skill_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "do_skill_plan_category_mappings" ADD CONSTRAINT "do_skill_plan_category_mappings_category_id_do_skill_plan_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."do_skill_plan_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "do_skill_plan_skills" ADD CONSTRAINT "do_skill_plan_skills_plan_id_do_skill_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."do_skill_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "do_skill_plan_skills" ADD CONSTRAINT "do_skill_plan_skills_skill_id_do_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."do_skills"("id") ON DELETE no action ON UPDATE no action;