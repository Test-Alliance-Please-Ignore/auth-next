-- Seed taxation permission category and permission URNs
INSERT INTO permission_categories ("name", "description")
VALUES ('Taxation', 'Permissions for corporation taxation management')
ON CONFLICT ("name") DO UPDATE
	SET "description" = EXCLUDED."description",
		"updated_at" = now();
--> statement-breakpoint
WITH resolved_permission_category AS (
	SELECT "id" FROM permission_categories WHERE "name" = 'Taxation' LIMIT 1
)
INSERT INTO permissions ("urn", "name", "description", "category_id", "created_by")
SELECT
	'urn:tax:auditor',
	'Tax Auditor',
	'Operational taxation access for assessments, exports, and billing monitoring',
	"resolved_permission_category"."id",
	'system'
FROM resolved_permission_category
ON CONFLICT ("urn") DO UPDATE
	SET "name" = EXCLUDED."name",
		"description" = EXCLUDED."description",
		"category_id" = EXCLUDED."category_id",
		"updated_at" = now();
--> statement-breakpoint
WITH resolved_permission_category AS (
	SELECT "id" FROM permission_categories WHERE "name" = 'Taxation' LIMIT 1
)
INSERT INTO permissions ("urn", "name", "description", "category_id", "created_by")
SELECT
	'urn:tax:admin',
	'Tax Admin',
	'Administrative taxation access for rule/configuration changes and bill issuance controls',
	"resolved_permission_category"."id",
	'system'
FROM resolved_permission_category
ON CONFLICT ("urn") DO UPDATE
	SET "name" = EXCLUDED."name",
		"description" = EXCLUDED."description",
		"category_id" = EXCLUDED."category_id",
		"updated_at" = now();
--> statement-breakpoint

-- Seed system-managed group category and baseline tax access groups
WITH upsert_group_category AS (
	INSERT INTO categories ("name", "description", "visibility", "allow_group_creation")
	VALUES (
		'Taxation',
		'System-managed groups for corporation taxation access control',
		'system',
		'admin_only'
	)
	ON CONFLICT ("name") DO UPDATE
		SET "description" = EXCLUDED."description",
			"visibility" = EXCLUDED."visibility",
			"allow_group_creation" = EXCLUDED."allow_group_creation",
			"updated_at" = now()
	RETURNING "id"
),
resolved_group_category AS (
	SELECT "id" FROM upsert_group_category
	UNION ALL
	SELECT "id" FROM categories WHERE "name" = 'Taxation'
	LIMIT 1
)
INSERT INTO groups ("category_id", "name", "description", "visibility", "join_mode", "owner_id")
SELECT
	"resolved_group_category"."id",
	'Tax Auditor',
	'System-managed group granting urn:tax:auditor',
	'system',
	'invitation_only',
	'system'
FROM resolved_group_category
ON CONFLICT ("category_id", "name") DO UPDATE
	SET "description" = EXCLUDED."description",
		"visibility" = EXCLUDED."visibility",
		"join_mode" = EXCLUDED."join_mode",
		"updated_at" = now();
--> statement-breakpoint
WITH resolved_group_category AS (
	SELECT "id" FROM categories WHERE "name" = 'Taxation' LIMIT 1
)
INSERT INTO groups ("category_id", "name", "description", "visibility", "join_mode", "owner_id")
SELECT
	"resolved_group_category"."id",
	'Tax Admin',
	'System-managed group granting urn:tax:admin',
	'system',
	'invitation_only',
	'system'
FROM resolved_group_category
ON CONFLICT ("category_id", "name") DO UPDATE
	SET "description" = EXCLUDED."description",
		"visibility" = EXCLUDED."visibility",
		"join_mode" = EXCLUDED."join_mode",
		"updated_at" = now();
--> statement-breakpoint

-- Attach seeded permissions to seeded groups for all group members
WITH auditor_group AS (
	SELECT g."id" AS "group_id"
	FROM groups g
	JOIN categories c ON c."id" = g."category_id"
	WHERE c."name" = 'Taxation' AND g."name" = 'Tax Auditor'
	LIMIT 1
),
auditor_permission AS (
	SELECT p."id" AS "permission_id" FROM permissions p WHERE p."urn" = 'urn:tax:auditor' LIMIT 1
)
INSERT INTO group_permissions ("group_id", "permission_id", "target_type", "created_by")
SELECT
	auditor_group."group_id",
	auditor_permission."permission_id",
	'all_members',
	'system'
FROM auditor_group, auditor_permission
ON CONFLICT ("group_id", "permission_id") DO NOTHING;
--> statement-breakpoint
WITH admin_group AS (
	SELECT g."id" AS "group_id"
	FROM groups g
	JOIN categories c ON c."id" = g."category_id"
	WHERE c."name" = 'Taxation' AND g."name" = 'Tax Admin'
	LIMIT 1
),
admin_permission AS (
	SELECT p."id" AS "permission_id" FROM permissions p WHERE p."urn" = 'urn:tax:admin' LIMIT 1
)
INSERT INTO group_permissions ("group_id", "permission_id", "target_type", "created_by")
SELECT
	admin_group."group_id",
	admin_permission."permission_id",
	'all_members',
	'system'
FROM admin_group, admin_permission
ON CONFLICT ("group_id", "permission_id") DO NOTHING;
