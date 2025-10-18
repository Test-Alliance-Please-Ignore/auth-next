-- Migration: initial_schema
-- Version: 1
-- Created: 2024-01-18
-- Description: Initial schema for SessionStore Durable Object

-- Root users table - permanent identity for EVE SSO accounts
CREATE TABLE root_users (
	root_user_id TEXT PRIMARY KEY,
	provider TEXT NOT NULL,
	provider_user_id TEXT NOT NULL,
	email TEXT NOT NULL,
	name TEXT NOT NULL,
	owner_hash TEXT NULL,
	is_admin INTEGER NOT NULL DEFAULT 0,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	UNIQUE(provider, provider_user_id)
);

CREATE UNIQUE INDEX idx_root_users_provider_user ON root_users(provider, provider_user_id);
CREATE INDEX idx_root_users_owner_hash ON root_users(owner_hash) WHERE owner_hash IS NOT NULL;
CREATE INDEX idx_root_users_admin ON root_users(is_admin) WHERE is_admin = 1;

-- Sessions table - ephemeral tokens tied to root users
CREATE TABLE sessions (
	session_id TEXT PRIMARY KEY,
	root_user_id TEXT NOT NULL,
	access_token TEXT NOT NULL,
	refresh_token TEXT NOT NULL,
	expires_at INTEGER NOT NULL,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
);

CREATE INDEX idx_sessions_root_user ON sessions(root_user_id);
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);

-- Account links table - links root users to legacy accounts
CREATE TABLE account_links (
	link_id TEXT PRIMARY KEY,
	root_user_id TEXT NOT NULL,
	legacy_system TEXT NOT NULL,
	legacy_user_id TEXT NOT NULL,
	legacy_username TEXT NOT NULL,
	superuser INTEGER NOT NULL DEFAULT 0,
	staff INTEGER NOT NULL DEFAULT 0,
	active INTEGER NOT NULL DEFAULT 0,
	primary_character TEXT NOT NULL DEFAULT '',
	primary_character_id TEXT NOT NULL DEFAULT '',
	groups TEXT NOT NULL DEFAULT '[]',
	linked_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	UNIQUE(root_user_id, legacy_system)
);

CREATE INDEX idx_account_links_root_user ON account_links(root_user_id);
CREATE UNIQUE INDEX idx_account_links_legacy_user ON account_links(legacy_system, legacy_user_id);

-- Character links table - links root users to EVE characters
CREATE TABLE character_links (
	link_id TEXT PRIMARY KEY,
	root_user_id TEXT NOT NULL,
	character_id INTEGER NOT NULL,
	character_name TEXT NOT NULL,
	is_primary INTEGER NOT NULL DEFAULT 0,
	linked_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	UNIQUE(character_id)
);

CREATE INDEX idx_character_links_root_user ON character_links(root_user_id);
CREATE UNIQUE INDEX idx_character_links_character ON character_links(character_id);
CREATE UNIQUE INDEX idx_character_links_primary ON character_links(root_user_id) WHERE is_primary = 1;

-- Provider links table - links root users to secondary OAuth providers
CREATE TABLE provider_links (
	link_id TEXT PRIMARY KEY,
	root_user_id TEXT NOT NULL,
	provider TEXT NOT NULL,
	provider_user_id TEXT NOT NULL,
	provider_username TEXT NOT NULL,
	linked_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	UNIQUE(root_user_id, provider),
	UNIQUE(provider, provider_user_id)
);

CREATE INDEX idx_provider_links_root_user ON provider_links(root_user_id);
CREATE UNIQUE INDEX idx_provider_links_provider_user ON provider_links(provider, provider_user_id);

-- OIDC states table for CSRF protection
CREATE TABLE oidc_states (
	state TEXT PRIMARY KEY,
	session_id TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	expires_at INTEGER NOT NULL
);

CREATE INDEX idx_oidc_states_expires_at ON oidc_states(expires_at);