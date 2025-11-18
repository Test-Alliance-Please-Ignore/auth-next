# esi

Cloudflare Worker with Esi Durable Object.

## Features

- **Durable Object**: SQLite-backed Durable Object with RPC support
- **WebSocket Support**: WebSocket hibernation API handlers
- **Database**: PostgreSQL with Drizzle ORM
- **Web Framework**: Hono
- **Testing**: Vitest with Cloudflare Workers pool

## Development

```bash
# Start development server
just dev -F esi

# Run tests
pnpm test

# Deploy
just deploy -F esi
```

## Database

```bash
# Generate migrations
just db-generate esi

# Run migrations
just db-migrate esi

# Push schema changes (dev only)
just db-push esi

# Open Drizzle Studio
just db-studio esi
```

## Using the Durable Object

The Esi Durable Object is available to this worker via the `ESI` binding.

### From within this worker:

```typescript
import type { Esi } from '@repo/esi'
import { getStub } from '@repo/do-utils'

// Get a stub to the Durable Object
const stub = getStub<Esi>(c.env.ESI, 'unique-id')

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
           "name": "ESI",
           "class_name": "Esi",
           "script_name": "esi",
         },
       ],
     },
   }
   ```

2. Add the dependency:

   ```bash
   pnpm -F your-worker add '@repo/esi@workspace:*'
   ```

3. Add the binding to your context types and use it!
