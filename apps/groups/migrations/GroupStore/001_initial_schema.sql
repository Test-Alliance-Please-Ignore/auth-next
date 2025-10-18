-- Migration: initial_schema
-- Version: 1
-- Created: 2024-01-18
-- Description: Initial schema for GroupStore Durable Object

-- Groups table
CREATE TABLE groups (
	group_id TEXT PRIMARY KEY,
	name TEXT NOT NULL UNIQUE,
	slug TEXT NOT NULL UNIQUE,
	description TEXT,
	group_type TEXT NOT NULL,
	visibility TEXT NOT NULL,
	joinability TEXT NOT NULL,
	is_leaveable INTEGER NOT NULL DEFAULT 1,
	auto_approve_rules TEXT,
	owner_id TEXT NOT NULL,
	category_id TEXT,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
);

CREATE INDEX idx_groups_slug ON groups(slug);
CREATE INDEX idx_groups_owner ON groups(owner_id);
CREATE INDEX idx_groups_type ON groups(group_type);
CREATE INDEX idx_groups_category ON groups(category_id);

-- Group members table
CREATE TABLE group_members (
	membership_id TEXT PRIMARY KEY,
	group_id TEXT NOT NULL,
	root_user_id TEXT NOT NULL,
	role TEXT NOT NULL,
	status TEXT NOT NULL,
	assignment_type TEXT NOT NULL,
	can_leave INTEGER NOT NULL DEFAULT 1,
	joined_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	UNIQUE(group_id, root_user_id)
);

CREATE INDEX idx_group_members_group ON group_members(group_id);
CREATE INDEX idx_group_members_user ON group_members(root_user_id);
CREATE INDEX idx_group_members_status ON group_members(status);

-- Group join requests table
CREATE TABLE group_join_requests (
	request_id TEXT PRIMARY KEY,
	group_id TEXT NOT NULL,
	root_user_id TEXT NOT NULL,
	message TEXT,
	status TEXT NOT NULL,
	reviewed_by TEXT,
	reviewed_at INTEGER,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
);

CREATE INDEX idx_join_requests_group ON group_join_requests(group_id);
CREATE INDEX idx_join_requests_user ON group_join_requests(root_user_id);
CREATE INDEX idx_join_requests_status ON group_join_requests(status);

-- Group invites table
CREATE TABLE group_invites (
	invite_id TEXT PRIMARY KEY,
	group_id TEXT NOT NULL,
	invited_user_id TEXT NOT NULL,
	invited_by TEXT NOT NULL,
	status TEXT NOT NULL,
	expires_at INTEGER NOT NULL,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	invite_code TEXT,
	max_uses INTEGER,
	current_uses INTEGER DEFAULT 0,
	revoked_at INTEGER
);

CREATE INDEX idx_invites_group ON group_invites(group_id);
CREATE INDEX idx_invites_user ON group_invites(invited_user_id);
CREATE INDEX idx_invites_status ON group_invites(status);
CREATE UNIQUE INDEX idx_invites_code ON group_invites(invite_code) WHERE invite_code IS NOT NULL;

-- Group categories table
CREATE TABLE group_categories (
	category_id TEXT PRIMARY KEY,
	name TEXT NOT NULL UNIQUE,
	description TEXT,
	display_order INTEGER NOT NULL,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
);

CREATE INDEX idx_categories_order ON group_categories(display_order);

-- Group roles table
CREATE TABLE group_roles (
	role_id TEXT PRIMARY KEY,
	group_id TEXT NOT NULL,
	role_name TEXT NOT NULL,
	permissions TEXT NOT NULL,
	priority INTEGER NOT NULL,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	UNIQUE(group_id, role_name)
);

CREATE INDEX idx_group_roles_group ON group_roles(group_id);

-- Derived group rules table
CREATE TABLE derived_group_rules (
	rule_id TEXT PRIMARY KEY,
	derived_group_id TEXT NOT NULL,
	rule_type TEXT NOT NULL,
	source_group_ids TEXT,
	condition_rules TEXT,
	priority INTEGER NOT NULL,
	is_active INTEGER NOT NULL DEFAULT 1,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
);

CREATE INDEX idx_derived_rules_group ON derived_group_rules(derived_group_id);
CREATE INDEX idx_derived_rules_active ON derived_group_rules(is_active);