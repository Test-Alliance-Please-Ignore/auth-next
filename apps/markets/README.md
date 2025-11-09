# markets

Cloudflare Worker with Markets Durable Object.

## Features

- **Durable Object**: SQLite-backed Durable Object with RPC support
- **WebSocket Support**: WebSocket hibernation API handlers
- **Database**: PostgreSQL with Drizzle ORM
- **Web Framework**: Hono
- **Testing**: Vitest with Cloudflare Workers pool
- **Automatic Snapshot Cleanup**: Configurable ring buffer for market data snapshots

## Development

```bash
# Start development server
just dev -F markets

# Run tests
pnpm test

# Deploy
just deploy -F markets
```

## Database

```bash
# Generate migrations
just db-generate markets

# Run migrations
just db-migrate markets

# Push schema changes (dev only)
just db-push markets

# Open Drizzle Studio
just db-studio markets
```

## Snapshot Cleanup

The Markets worker automatically manages storage by implementing a configurable ring buffer for market data snapshots. When the maximum number of snapshots is exceeded, the oldest snapshots are automatically deleted along with their associated data.

### Configuration

The maximum number of snapshots to retain can be configured in two ways:

1. **Environment Variable** (Global Default):
   Set `MAX_SNAPSHOTS_PER_LOCATION` in `wrangler.jsonc`:
   ```jsonc
   {
     "vars": {
       "MAX_SNAPSHOTS_PER_LOCATION": 168  // Default: 168 (1 week of hourly snapshots)
     }
   }
   ```

2. **Per-Location Override** (Optional):
   Can be configured per Durable Object instance via SQLite storage.
   Set `max_snapshots` in the config table to override the environment variable.

### Retention Recommendations

| Use Case | Value | Retention Period |
|----------|-------|------------------|
| Default (1 week) | 168 | 7 days × 24 hours |
| Development/Testing | 24 | 1 day |
| High-frequency analysis | 336 | 2 weeks |
| Long-term historical | 720 | 30 days |
| Minimal storage | 48 | 2 days |

### How It Works

- After each successful snapshot creation, the cleanup process runs automatically
- Only snapshots with status `complete` are counted and eligible for deletion
- Oldest snapshots are deleted first (ring buffer behavior)
- Associated `market_orders` data is automatically deleted via CASCADE
- Orphaned `latest_market_prices` records are also cleaned up
- Cleanup failures are logged but don't block snapshot creation

## Using the Durable Object

The Markets Durable Object is available to this worker via the `MARKETS` binding.

### From within this worker:

```typescript
import { getStub } from '@repo/do-utils'

import type { Markets } from '@repo/markets'

// Get a stub to the Durable Object
const stub = getStub<Markets>(c.env.MARKETS, 'unique-id')

// Call RPC methods
const result = await stub.exampleMethod('hello')
```

### From other workers:

1. Add the binding to `wrangler.jsonc`:

   ```jsonc
   {
     "durable_objects": {
       "bindings": [
         {
           "name": "MARKETS",
           "class_name": "Markets",
           "script_name": "markets",
         },
       ],
     },
   }
   ```

2. Add the dependency:

   ```bash
   pnpm -F your-worker add '@repo/markets@workspace:*'
   ```

3. Add the binding to your context types and use it!
