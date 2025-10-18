-- Migration: initial_schema
-- Version: 1
-- Created: 2024-01-18
-- Description: Initial schema for CharacterDataStore Durable Object

-- Characters table
CREATE TABLE characters (
	character_id INTEGER PRIMARY KEY,
	name TEXT NOT NULL,
	corporation_id INTEGER NOT NULL,
	alliance_id INTEGER,
	security_status REAL,
	birthday TEXT NOT NULL,
	gender TEXT NOT NULL,
	race_id INTEGER NOT NULL,
	bloodline_id INTEGER NOT NULL,
	ancestry_id INTEGER,
	description TEXT,
	last_updated INTEGER NOT NULL,
	next_update_at INTEGER NOT NULL,
	update_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_characters_next_update ON characters(next_update_at);
CREATE INDEX idx_characters_corporation ON characters(corporation_id);

-- Corporations table
CREATE TABLE corporations (
	corporation_id INTEGER PRIMARY KEY,
	name TEXT NOT NULL,
	ticker TEXT NOT NULL,
	member_count INTEGER NOT NULL,
	ceo_id INTEGER NOT NULL,
	creator_id INTEGER NOT NULL,
	date_founded TEXT,
	tax_rate REAL NOT NULL,
	url TEXT,
	description TEXT,
	alliance_id INTEGER,
	last_updated INTEGER NOT NULL,
	next_update_at INTEGER NOT NULL,
	update_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_corporations_next_update ON corporations(next_update_at);

-- Character history table for tracking changes
CREATE TABLE character_history (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	character_id INTEGER NOT NULL,
	changed_at INTEGER NOT NULL,
	field_name TEXT NOT NULL,
	old_value TEXT,
	new_value TEXT,
	FOREIGN KEY (character_id) REFERENCES characters(character_id) ON DELETE CASCADE
);

CREATE INDEX idx_history_character ON character_history(character_id, changed_at);

-- Character skills aggregate table
CREATE TABLE character_skills (
	character_id INTEGER PRIMARY KEY,
	total_sp INTEGER NOT NULL,
	unallocated_sp INTEGER NOT NULL DEFAULT 0,
	last_updated INTEGER NOT NULL,
	next_update_at INTEGER NOT NULL,
	update_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_character_skills_next_update ON character_skills(next_update_at);

-- Individual skills table
CREATE TABLE skills (
	character_id INTEGER NOT NULL,
	skill_id INTEGER NOT NULL,
	skillpoints_in_skill INTEGER NOT NULL,
	trained_skill_level INTEGER NOT NULL,
	active_skill_level INTEGER NOT NULL,
	PRIMARY KEY (character_id, skill_id)
);

CREATE INDEX idx_skills_character ON skills(character_id);

-- Skill queue table
CREATE TABLE skillqueue (
	character_id INTEGER NOT NULL,
	skill_id INTEGER NOT NULL,
	finished_level INTEGER NOT NULL,
	queue_position INTEGER NOT NULL,
	start_date TEXT,
	finish_date TEXT,
	training_start_sp INTEGER,
	level_start_sp INTEGER,
	level_end_sp INTEGER,
	PRIMARY KEY (character_id, queue_position)
);

CREATE INDEX idx_skillqueue_character ON skillqueue(character_id);

-- Corporation history table
CREATE TABLE corporation_history (
	character_id INTEGER NOT NULL,
	record_id INTEGER NOT NULL,
	corporation_id INTEGER NOT NULL,
	corporation_name TEXT,
	corporation_ticker TEXT,
	alliance_id INTEGER,
	alliance_name TEXT,
	alliance_ticker TEXT,
	start_date TEXT NOT NULL,
	end_date TEXT,
	is_deleted INTEGER NOT NULL DEFAULT 0,
	last_updated INTEGER NOT NULL DEFAULT 0,
	PRIMARY KEY (character_id, record_id)
);

CREATE INDEX idx_corp_history_character ON corporation_history(character_id);
CREATE INDEX idx_corp_history_dates ON corporation_history(start_date, end_date);

-- Corporation history metadata table
CREATE TABLE corporation_history_metadata (
	character_id INTEGER PRIMARY KEY,
	last_fetched INTEGER NOT NULL,
	next_fetch_at INTEGER NOT NULL
);