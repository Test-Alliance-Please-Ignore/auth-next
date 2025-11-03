# markets

Cloudflare Worker with Markets Durable Object.

## Features

- **Durable Object**: SQLite-backed Durable Object with RPC support
- **WebSocket Support**: WebSocket hibernation API handlers
- **Database**: PostgreSQL with Drizzle ORM
- **Web Framework**: Hono
- **Testing**: Vitest with Cloudflare Workers pool

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

## Using the Durable Object

The Markets Durable Object is available to this worker via the `MARKETS` binding.

### From within this worker:

```typescript
import type { Markets } from '@repo/markets'
import { getStub } from '@repo/do-utils'

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
