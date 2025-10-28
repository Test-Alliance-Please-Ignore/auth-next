# broadcasts

Cloudflare Worker with Broadcasts Durable Object.

## Features

- **Durable Object**: SQLite-backed Durable Object with RPC support
- **WebSocket Support**: WebSocket hibernation API handlers
- **Database**: PostgreSQL with Drizzle ORM
- **Web Framework**: Hono
- **Testing**: Vitest with Cloudflare Workers pool

## Development

```bash
# Start development server
just dev -F broadcasts

# Run tests
pnpm test

# Deploy
just deploy -F broadcasts
```

## Database

```bash
# Generate migrations
just db-generate broadcasts

# Run migrations
just db-migrate broadcasts

# Push schema changes (dev only)
just db-push broadcasts

# Open Drizzle Studio
just db-studio broadcasts
```

## Using the Durable Object

The Broadcasts Durable Object is available to this worker via the `BROADCASTS` binding.

### From within this worker:

```typescript
import type { Broadcasts } from '@repo/broadcasts'
import { getStub } from '@repo/do-utils'

// Get a stub to the Durable Object
const stub = getStub<Broadcasts>(c.env.BROADCASTS, 'unique-id')

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
           "name": "BROADCASTS",
           "class_name": "Broadcasts",
           "script_name": "broadcasts",
         },
       ],
     },
   }
   ```

2. Add the dependency:

   ```bash
   pnpm -F your-worker add '@repo/broadcasts@workspace:*'
   ```

3. Add the binding to your context types and use it!
