# fleets

Cloudflare Worker with Fleets Durable Object.

## Features

- **Durable Object**: SQLite-backed Durable Object with RPC support
- **WebSocket Support**: WebSocket hibernation API handlers
- **Database**: PostgreSQL with Drizzle ORM
- **Web Framework**: Hono
- **Testing**: Vitest with Cloudflare Workers pool

## Development

```bash
# Start development server
just dev -F fleets

# Run tests
pnpm test

# Deploy
just deploy -F fleets
```

## Database

```bash
# Generate migrations
just db-generate fleets

# Run migrations
just db-migrate fleets

# Push schema changes (dev only)
just db-push fleets

# Open Drizzle Studio
just db-studio fleets
```

## Using the Durable Object

The Fleets Durable Object is available to this worker via the `FLEETS` binding.

### From within this worker:

```typescript
import { getStub } from '@repo/do-utils'

import type { Fleets } from '@repo/fleets'

// Get a stub to the Durable Object
const stub = getStub<Fleets>(c.env.FLEETS, 'unique-id')

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
           "name": "FLEETS",
           "class_name": "Fleets",
           "script_name": "fleets",
         },
       ],
     },
   }
   ```

2. Add the dependency:

   ```bash
   pnpm -F your-worker add '@repo/fleets@workspace:*'
   ```

3. Add the binding to your context types and use it!

## Fleet Tracking Permissions Matrix

Note: fleet tracking authorization is enforced by the Core API routes in `apps/core/src/routes/fleets.ts` and reflected in UI route visibility under `apps/ui/src/client/features/fleet-tracking`.

### Permission URNs

- `urn:fleet-tracking:create`
- `urn:fleet-tracking:view-all`
- Site admins bypass both checks

### Pages

| Page | Site Admin | `view-all` | `create` | Notes |
|---|---:|---:|---:|---|
| `/fleet-tracking` | Yes | Yes | Yes | create-only users are scoped to their own sessions |
| `/fleet-tracking/new` | Yes | Yes | Yes | Start submit requires character ownership |
| `/fleet-tracking/stats` and stats details | Yes | Yes | No | Overview/search/corp stats are view-all only |

### API Endpoints (`/api/fleets/tracking*`)

| Endpoint | Site Admin | `view-all` | `create` | Access rule |
|---|---:|---:|---:|---|
| `POST /tracking` | Yes | Yes | Yes | Must own selected character |
| `GET /tracking` | Yes | Yes | Yes | create-only forced to own `startedByUserId` |
| `GET /tracking/:sessionId` | Yes | Yes | Yes | create-only limited to own sessions |
| `GET /tracking/:sessionId/live` | Yes | Yes | Conditional | create-only: own session + active |
| `GET /tracking/:sessionId/current-members` | Yes | Yes | Conditional | create-only: own session + active |
| `GET /tracking/:sessionId/timeline` | Yes | Yes | Conditional | create-only: own session + active |
| `GET /tracking/:sessionId/members/:characterId/ship-history` | Yes | Yes | Conditional | create-only: own session + active |
| `GET /tracking/:sessionId/roster` | Yes | Yes | Conditional | create-only: own session + active |
| `GET /tracking/:sessionId/summary` | Yes | Yes | Yes | Owner/admin/view-all |
| `DELETE /tracking/:sessionId` | Yes | No (unless owner) | No (unless owner) | Owner of active session or admin |
| `POST /tracking/:sessionId/kick-members` | Yes | No (unless owner) | No (unless owner) | Owner of active session or admin |

### Stats Endpoints (`/api/fleets/tracking/stats*`)

| Endpoint | Site Admin | `view-all` | `create` | Access rule |
|---|---:|---:|---:|---|
| `GET /stats/overview` | Yes | Yes | No | view-all only |
| `GET /stats/search` | Yes | Yes | No | view-all only |
| `GET /stats/corporations/:corpId` | Yes | Yes | No | view-all only |
| `GET /stats/characters/:characterId` | Yes | Yes | Yes (if own) | Own character unless view-all/admin |
| `GET /stats/users/:userId` | Yes | Yes | Yes (if self) | Self unless view-all/admin |

### Related endpoint used by session details

| Endpoint | Gate |
|---|---|
| `GET /api/broadcasts/by-fleet-session/:fleetSessionId` | Broadcast target send-view permission (or site admin), not fleet-tracking URNs |
