-- Optimization script for EVE Online SDE Dogma attribute tables
-- Run this after importing the dogma data to improve query performance

-- 1. Increase statistics sampling for better query planning on large table
-- This helps PostgreSQL make better decisions about query execution plans
ALTER TABLE dgm_type_attributes ALTER COLUMN type_id SET STATISTICS 1000;
ALTER TABLE dgm_type_attributes ALTER COLUMN attribute_id SET STATISTICS 1000;

-- 2. Add partial index for published attributes filtered by category
-- This makes queries that filter by category AND published status more efficient
CREATE INDEX IF NOT EXISTS dgm_attribute_types_category_published_idx
ON dgm_attribute_types(category_id)
WHERE published = true;

-- 3. Force re-analyze of tables to update statistics
-- This ensures the query planner has the most up-to-date information
ANALYZE dgm_attribute_categories;
ANALYZE dgm_attribute_types;
ANALYZE dgm_type_attributes;

-- 4. Monitoring queries to verify optimization effectiveness
-- Run these queries to check index usage after optimization:

-- Check index usage statistics
/*
SELECT
    schemaname,
    tablename,
    indexname,
    idx_scan as index_scans,
    idx_tup_read as tuples_read,
    idx_tup_fetch as tuples_fetched
FROM pg_stat_user_indexes
WHERE tablename LIKE 'dgm_%'
ORDER BY idx_scan DESC;
*/

-- Check table sizes
/*
SELECT
    relname as table_name,
    pg_size_pretty(pg_total_relation_size(relid)) as total_size,
    pg_size_pretty(pg_relation_size(relid)) as table_size,
    pg_size_pretty(pg_total_relation_size(relid) - pg_relation_size(relid)) as indexes_size
FROM pg_stat_user_tables
WHERE relname LIKE 'dgm_%'
ORDER BY pg_total_relation_size(relid) DESC;
*/

-- Check index sizes individually
/*
SELECT
    tablename,
    indexname,
    pg_size_pretty(pg_relation_size(indexname::regclass)) as index_size
FROM pg_indexes
WHERE tablename LIKE 'dgm_%'
ORDER BY pg_relation_size(indexname::regclass) DESC;
*/