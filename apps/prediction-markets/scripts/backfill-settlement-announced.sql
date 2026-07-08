-- ============================================================================
-- One-time backfill: grandfather existing terminal markets as settlement-announced
-- Target DB: the prediction-markets Neon database (pm_markets)
-- ============================================================================
--
-- WHEN TO RUN
--   Once, immediately AFTER migration 0004_abandoned_justice is applied (it adds
--   pm_markets.settlement_announced_at) and ideally before the next prediction-
--   markets reconcile cron tick (runs every 5 minutes). Running it promptly closes
--   the window in which the self-heal could re-notify an already-announced market.
--
-- WHY
--   The live resolve/void path already posted the aggregate result to each market's
--   forum thread and DMed participants BEFORE the settlement_announced_at column
--   existed. Post-migration every terminal row is therefore NULL. The reconcile
--   "settlement self-heal" (pass d) re-posts any terminal market whose flag is NULL
--   within its look-back window — which would re-announce + re-DM markets that were
--   already notified by the old code. Stamping the flag on every existing terminal
--   row tells the self-heal "already done", so only markets settled AFTER this point
--   can ever be healed.
--
-- SAFETY
--   * Idempotent  — the `settlement_announced_at IS NULL` guard means a re-run is a
--                   no-op and it never overwrites a value the app has set.
--   * Atomic      — wrapped in a single transaction.
--   * Forward-only— touches only rows that predate the flag; new terminal markets
--                   are unaffected and heal normally.
--   Dry run first if you like: run just the first SELECT to see the impact.
-- ============================================================================

BEGIN;

-- 1) Preview — how many rows this will backfill (0 on a re-run).
SELECT count(*) AS rows_to_backfill
FROM pm_markets
WHERE status IN ('resolved', 'voided')
  AND settlement_announced_at IS NULL;

-- 2) Backfill — stamp the terminal-transition time (updated_at) as the announce time.
--    (updated_at is NOT NULL and, for a terminal market, equals the settlement time.)
UPDATE pm_markets
SET settlement_announced_at = updated_at
WHERE status IN ('resolved', 'voided')
  AND settlement_announced_at IS NULL;

-- 3) Verify — MUST return 0: no un-flagged terminal markets remain.
--    (Guaranteed, since this predicate matches the UPDATE's. If it isn't 0, ROLLBACK.)
SELECT count(*) AS remaining_unflagged_terminal
FROM pm_markets
WHERE status IN ('resolved', 'voided')
  AND settlement_announced_at IS NULL;

COMMIT;
