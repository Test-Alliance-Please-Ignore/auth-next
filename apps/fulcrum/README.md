# fulcrum

Cloudflare Worker with Fulcrum Durable Object.

## Features

- **Durable Object**: SQLite-backed Durable Object with RPC support
- **WebSocket Support**: WebSocket hibernation API handlers
- **Database**: PostgreSQL with Drizzle ORM
- **Web Framework**: Hono
- **Testing**: Vitest with Cloudflare Workers pool

## Development

```bash
# Start development server
just dev -F fulcrum

# Run tests
pnpm test

# Deploy
just deploy -F fulcrum
```

## Database

```bash
# Generate migrations
just db-generate fulcrum

# Run migrations
just db-migrate fulcrum

# Push schema changes (dev only)
just db-push fulcrum

# Open Drizzle Studio
just db-studio fulcrum
```

## Using the Durable Object

The Fulcrum Durable Object is available to this worker via the `FULCRUM` binding.

### From within this worker:

```typescript
import type { Fulcrum } from '@repo/fulcrum'
import { getStub } from '@repo/do-utils'

// Get a stub to the Durable Object
const stub = getStub<Fulcrum>(c.env.FULCRUM, 'unique-id')

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
           "name": "FULCRUM",
           "class_name": "Fulcrum",
           "script_name": "fulcrum",
         },
       ],
     },
   }
   ```

2. Add the dependency:

   ```bash
   pnpm -F your-worker add '@repo/fulcrum@workspace:*'
   ```

3. Add the binding to your context types and use it!
