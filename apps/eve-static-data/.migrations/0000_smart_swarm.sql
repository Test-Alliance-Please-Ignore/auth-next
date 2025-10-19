CREATE TABLE "sde_version" (
	"version" text PRIMARY KEY NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"checksum" text
);
--> statement-breakpoint
CREATE TABLE "skill_attributes" (
	"skill_id" integer NOT NULL,
	"attribute_name" text NOT NULL,
	"attribute_value" numeric NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skill_attributes_skill_id_attribute_name_unique" UNIQUE("skill_id","attribute_name")
);
--> statement-breakpoint
CREATE TABLE "skill_categories" (
	"id" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skill_groups" (
	"id" integer PRIMARY KEY NOT NULL,
	"category_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"published" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skill_requirements" (
	"skill_id" integer NOT NULL,
	"required_skill_id" integer NOT NULL,
	"required_level" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skill_requirements_skill_id_required_skill_id_unique" UNIQUE("skill_id","required_skill_id")
);
--> statement-breakpoint
CREATE TABLE "skills" (
	"id" integer PRIMARY KEY NOT NULL,
	"group_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"rank" integer NOT NULL,
	"primary_attribute" text,
	"secondary_attribute" text,
	"published" boolean DEFAULT true NOT NULL,
	"can_not_be_trained" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "skill_attributes" ADD CONSTRAINT "skill_attributes_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_groups" ADD CONSTRAINT "skill_groups_category_id_skill_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."skill_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_requirements" ADD CONSTRAINT "skill_requirements_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_requirements" ADD CONSTRAINT "skill_requirements_required_skill_id_skills_id_fk" FOREIGN KEY ("required_skill_id") REFERENCES "public"."skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_group_id_skill_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."skill_groups"("id") ON DELETE no action ON UPDATE no action;