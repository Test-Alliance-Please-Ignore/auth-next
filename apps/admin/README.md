# Admin Worker

Admin worker providing RPC methods for administrative operations.

## Overview

This worker extends `WorkerEntrypoint` and exposes RPC methods for:
- User management (deletion)
- Character management (ownership transfer, deletion)
- User/character search and lookup
- Admin activity audit log

## Architecture

- **RPC-based**: Not exposed via HTTP, only callable from other workers (primarily core worker)
- **Type-safe**: Uses `@repo/admin` for shared type definitions
- **Audit logging**: All operations logged to dedicated `admin_audit_log` table

## Scripts

```bash
# Development
pnpm dev

# Build
pnpm build

# Deploy
pnpm deploy

# Database
pnpm db:generate  # Generate migrations
pnpm db:push      # Push schema changes
pnpm db:migrate   # Run migrations
pnpm db:studio    # Open Drizzle Studio

# Testing
pnpm test

# Logs
pnpm tail
```

## Environment Variables

- `DATABASE_URL` - Neon PostgreSQL connection string
- `EVE_TOKEN_STORE` - Durable Object binding
- `EVE_CHARACTER_DATA` - Durable Object binding
