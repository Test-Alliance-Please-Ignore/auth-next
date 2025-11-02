CREATE TABLE "do_skill_attributes" (
	"skill_id" text NOT NULL,
	"attribute_name" text NOT NULL,
	"attribute_value" numeric NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "do_skill_attributes_skill_id_attribute_name_unique" UNIQUE("skill_id","attribute_name")
);
--> statement-breakpoint
CREATE TABLE "do_skill_categories" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "do_skill_groups" (
	"id" text PRIMARY KEY NOT NULL,
	"category_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"published" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "do_skill_requirements" (
	"skill_id" text NOT NULL,
	"required_skill_id" text NOT NULL,
	"required_level" numeric NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "do_skill_requirements_skill_id_required_skill_id_unique" UNIQUE("skill_id","required_skill_id")
);
--> statement-breakpoint
CREATE TABLE "do_skills" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"rank" numeric NOT NULL,
	"primary_attribute" text,
	"secondary_attribute" text,
	"published" boolean DEFAULT true NOT NULL,
	"can_not_be_trained" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "do_skill_attributes" ADD CONSTRAINT "do_skill_attributes_skill_id_do_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."do_skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "do_skill_groups" ADD CONSTRAINT "do_skill_groups_category_id_do_skill_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."do_skill_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "do_skill_requirements" ADD CONSTRAINT "do_skill_requirements_skill_id_do_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."do_skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "do_skill_requirements" ADD CONSTRAINT "do_skill_requirements_required_skill_id_do_skills_id_fk" FOREIGN KEY ("required_skill_id") REFERENCES "public"."do_skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "do_skills" ADD CONSTRAINT "do_skills_group_id_do_skill_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."do_skill_groups"("id") ON DELETE no action ON UPDATE no action;