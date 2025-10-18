-- Migration: add_wallet_balance
-- Version: 2
-- Created: 2025-10-18

-- Add wallet balance column to characters table
ALTER TABLE characters ADD COLUMN wallet_balance REAL DEFAULT 0;

-- Create index for wallet balance queries (useful for filtering)
CREATE INDEX idx_characters_wallet_balance ON characters(wallet_balance);

-- Add wallet last updated timestamp to track freshness
ALTER TABLE characters ADD COLUMN wallet_updated_at INTEGER;

-- Create index for wallet update timestamp
CREATE INDEX idx_characters_wallet_updated_at ON characters(wallet_updated_at);
