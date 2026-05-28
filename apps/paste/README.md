# Paste Worker

Paste worker providing RPC methods for paste creation, viewing, encryption/decryption, admin listing, and expiry cleanup.

## Overview

This worker extends `WorkerEntrypoint` and is **RPC-only** (not public HTTP).

Core responsibilities:

- Create and update plaintext pastes
- Enforce visibility (`alliance` or `public`)
- Enforce optional/required password protection
- Encrypt/decrypt protected paste content
- Store paste content in R2
- Persist metadata/settings in Postgres via Drizzle
- Apply per-user creation limits
- Run scheduled expiry sweep and hard-delete expired objects + metadata

## Architecture

- **RPC-based**: Called from `apps/core` through `@repo/paste` interfaces
- **Storage split**:
  - Metadata/settings: Postgres (`pastes`, `paste_settings`)
  - Content blobs: R2 (`PASTE_BUCKET`)
- **Public decrypt throttling**: KV-backed attempt tracking (`PASTE_THROTTLE`)
- **Scheduled expiry**: `scheduled()` runs cleanup sweep

## Key Behavior

- Paste size limit: `1 MiB`
- Content format: plaintext-only validation
- Visibility:
  - `alliance`: requires authenticated alliance-member access via core routes
  - `public`: accessible by URL through public API path
- Password protection:
  - required for public pastes
  - uses symmetric encryption (`AES-256-GCM`) with `PBKDF2-SHA256`
- Expiration options are hardcoded presets:
  - `1h, 3h, 6h, 12h, 1d, 3d, 7d, 14d, 30d, indefinite`

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
pnpm db:migrate   # Run migrations
pnpm db:studio    # Open Drizzle Studio

# Testing
pnpm test

# Logs
pnpm tail
```

Notes:

- Do not use `db:push`; use migration workflow only.
- Migration artifacts are managed manually per repo conventions.

## Environment Bindings

- `DATABASE_URL` - Neon PostgreSQL connection string
- `PASTE_BUCKET` - R2 bucket for paste content objects
- `PASTE_THROTTLE` - KV namespace for public decrypt attempt throttling

## RPC Surface

Defined in [`packages/paste/src/index.ts`](/home/terminal/Code/auth-next/packages/paste/src/index.ts), including:

- `createPaste`
- `getPasteForAllianceViewer`
- `getPasteForPublicViewer`
- `decryptPaste`
- `canAttemptPublicDecrypt`
- `listCreatorPastes`
- `listAdminPastes`
- `updatePaste`
- `rotatePastePassword`
- `deletePaste`
- `getPasteSettings`
- `updatePasteSettings`
- `runExpirySweep`
