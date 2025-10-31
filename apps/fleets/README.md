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
import type { Fleets } from '@repo/fleets'
import { getStub } from '@repo/do-utils'

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
