-- MANUAL MIGRATION SCRIPT FOR CharacterDataStore Wallet Balance
-- Run this in the Cloudflare Dashboard SQL console for the CharacterDataStore Durable Object
-- This script includes both the schema changes and migration tracking updates

-- Step 1: Ensure the migrations tracking table exists
CREATE TABLE IF NOT EXISTS _migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at INTEGER NOT NULL,
    checksum TEXT NOT NULL,
    execution_time_ms INTEGER
);

-- Step 2: Check if migration 002 has already been applied
-- You can run this separately first to verify:
-- SELECT * FROM _migrations WHERE version = 2;

-- Step 3: Apply the wallet balance migration
-- Add wallet balance column to characters table
ALTER TABLE characters ADD COLUMN wallet_balance REAL DEFAULT 0;

-- Create index for wallet balance queries (useful for filtering)
CREATE INDEX idx_characters_wallet_balance ON characters(wallet_balance);

-- Add wallet last updated timestamp to track freshness
ALTER TABLE characters ADD COLUMN wallet_updated_at INTEGER;

-- Create index for wallet update timestamp
CREATE INDEX idx_characters_wallet_updated_at ON characters(wallet_updated_at);

-- Step 4: Record the migration in the tracking table
-- The checksum is the SHA-256 hash of the original migration file content
INSERT INTO _migrations (version, name, applied_at, checksum, execution_time_ms)
VALUES (
    2,
    '002_add_wallet_balance.sql',
    strftime('%s', 'now') * 1000, -- Current timestamp in milliseconds
    '83f3e405de14eef8f834373b93e903dfe1082da85767b02135e2c82a07554d5b',
    100 -- Approximate execution time
);

-- Step 5: Verify the migration was recorded
SELECT * FROM _migrations ORDER BY version;

-- Step 6: Verify the new columns exist
-- You can run this query to confirm the columns were added:
-- PRAGMA table_info(characters);

-- NOTES:
-- 1. Run each step sequentially in the Cloudflare Dashboard SQL console
-- 2. If you get an error that columns already exist, the migration may have partially applied
-- 3. The checksum must match exactly or the migration system will detect tampering
-- 4. The applied_at timestamp should be in milliseconds since Unix epoch