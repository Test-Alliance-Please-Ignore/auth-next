-- Custom SQL migration file, put your code below! --
WITH new_snapshots AS (
	INSERT INTO "corporation_structure_inventory_snapshots" (
		"corporation_id",
		"created_at",
		"activated_at"
	)
	SELECT DISTINCT "corporation_id", now(), now()
	FROM "corporation_structure_inventory"
	WHERE "snapshot_id" IS NULL
	RETURNING "id", "corporation_id"
)
UPDATE "corporation_structure_inventory" AS inventory
SET "snapshot_id" = snapshots."id"
FROM new_snapshots AS snapshots
WHERE inventory."corporation_id" = snapshots."corporation_id"
	AND inventory."snapshot_id" IS NULL;
