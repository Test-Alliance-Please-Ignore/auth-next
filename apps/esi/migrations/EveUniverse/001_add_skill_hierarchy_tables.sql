-- Migration: add_skill_hierarchy_tables
-- Version: 1
-- Created: 2025-10-18

-- Create types table for storing type information (skills, items, etc.)
CREATE TABLE IF NOT EXISTS types (
	type_id INTEGER PRIMARY KEY,
	name TEXT NOT NULL,
	group_id INTEGER NOT NULL,
	description TEXT,
	published INTEGER NOT NULL DEFAULT 1,
	cached_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_types_group_id ON types(group_id);
CREATE INDEX IF NOT EXISTS idx_types_cached_at ON types(cached_at);

-- Create groups table for storing group information
CREATE TABLE IF NOT EXISTS groups (
	group_id INTEGER PRIMARY KEY,
	name TEXT NOT NULL,
	category_id INTEGER NOT NULL,
	published INTEGER NOT NULL DEFAULT 1,
	cached_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_groups_category_id ON groups(category_id);
CREATE INDEX IF NOT EXISTS idx_groups_cached_at ON groups(cached_at);

-- Create categories table for storing category information
CREATE TABLE IF NOT EXISTS categories (
	category_id INTEGER PRIMARY KEY,
	name TEXT NOT NULL,
	published INTEGER NOT NULL DEFAULT 1,
	cached_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_categories_cached_at ON categories(cached_at);

-- Ensure names table exists (might already exist from previous implementation)
CREATE TABLE IF NOT EXISTS names (
	id INTEGER PRIMARY KEY,
	name TEXT NOT NULL,
	category TEXT NOT NULL,
	cached_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_names_category ON names(category);
CREATE INDEX IF NOT EXISTS idx_names_cached_at ON names(cached_at);
