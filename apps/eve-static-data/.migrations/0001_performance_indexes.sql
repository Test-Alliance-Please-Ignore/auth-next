-- Performance Optimization Migration
-- Adds PostgreSQL trigram indexes and other performance optimizations for item lookups

-- Enable pg_trgm extension for trigram matching (case-insensitive pattern matching)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Drop old inefficient B-tree index on type_name (if it exists)
DROP INDEX IF EXISTS inv_types_name_idx;

-- Create trigram GIN index for case-insensitive pattern matching on all items
-- This enables fast ILIKE/LIKE queries and similarity matching
-- Expected performance: 100-1000x improvement for name lookups
CREATE INDEX CONCURRENTLY IF NOT EXISTS inv_types_name_trgm_idx
ON inv_types
USING gin (lower(type_name) gin_trgm_ops);

-- Create partial trigram index for published items only (most common query pattern)
-- Smaller index size = faster queries and less disk I/O
CREATE INDEX CONCURRENTLY IF NOT EXISTS inv_types_published_name_trgm_idx
ON inv_types
USING gin (lower(type_name) gin_trgm_ops)
WHERE published = true;

-- Create covering index to reduce heap lookups for frequently accessed columns
-- This allows index-only scans without touching the main table
CREATE INDEX CONCURRENTLY IF NOT EXISTS inv_types_covering_idx
ON inv_types (type_id, group_id, market_group_id, published)
INCLUDE (type_name, volume, mass, capacity, portion_size, base_price, icon_id, race_id);

-- Composite index on invGroups to optimize join filtering
CREATE INDEX CONCURRENTLY IF NOT EXISTS inv_groups_category_published_idx
ON inv_groups (category_id, published);

-- Update table statistics for query planner optimization
ANALYZE inv_types;
ANALYZE inv_groups;
ANALYZE inv_categories;
ANALYZE market_groups;
