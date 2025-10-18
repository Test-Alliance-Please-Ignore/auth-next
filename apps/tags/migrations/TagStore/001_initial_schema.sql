-- Migration: initial_schema
-- Version: 1
-- Created: 2024-01-18
-- Description: Initial schema for TagStore Durable Object

-- Tags table
CREATE TABLE IF NOT EXISTS tags (
	tag_urn TEXT PRIMARY KEY,
	tag_type TEXT NOT NULL,
	display_name TEXT NOT NULL,
	eve_id INTEGER NOT NULL,
	metadata TEXT,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tags_type ON tags(tag_type);
CREATE INDEX IF NOT EXISTS idx_tags_eve_id ON tags(eve_id);

-- User tag assignments
CREATE TABLE IF NOT EXISTS user_tags (
	assignment_id TEXT PRIMARY KEY,
	root_user_id TEXT NOT NULL,
	tag_urn TEXT NOT NULL,
	source_character_id INTEGER NOT NULL,
	assigned_at INTEGER NOT NULL,
	last_verified_at INTEGER NOT NULL,
	UNIQUE(root_user_id, tag_urn, source_character_id)
);

CREATE INDEX IF NOT EXISTS idx_user_tags_user ON user_tags(root_user_id);
CREATE INDEX IF NOT EXISTS idx_user_tags_character ON user_tags(source_character_id);
CREATE INDEX IF NOT EXISTS idx_user_tags_urn ON user_tags(tag_urn);

-- Evaluation schedule
CREATE TABLE IF NOT EXISTS evaluation_schedule (
	root_user_id TEXT PRIMARY KEY,
	next_evaluation_at INTEGER NOT NULL,
	last_evaluated_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_evaluation_schedule_next ON evaluation_schedule(next_evaluation_at);