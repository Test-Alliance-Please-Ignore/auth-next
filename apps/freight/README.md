# freight

Cloudflare Worker with Freight Durable Object.

## Features

- **Durable Object**: SQLite-backed Durable Object with RPC support
- **WebSocket Support**: WebSocket hibernation API handlers
- **Database**: PostgreSQL with Drizzle ORM
- **Web Framework**: Hono
- **Testing**: Vitest with Cloudflare Workers pool

## Development

```bash
# Start development server
just dev -F freight

# Run tests
pnpm test

# Deploy
just deploy -F freight
```

## Database

```bash
# Generate migrations
just db-generate freight

# Run migrations
just db-migrate freight

# Push schema changes (dev only)
just db-push freight

# Open Drizzle Studio
just db-studio freight
```

## Using the Durable Object

The Freight Durable Object is available to this worker via the `FREIGHT` binding.

### From within this worker:

```typescript
import type { Freight } from '@repo/freight'
import { getStub } from '@repo/do-utils'

// Get a stub to the Durable Object
const stub = getStub<Freight>(c.env.FREIGHT, 'unique-id')

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
           "name": "FREIGHT",
           "class_name": "Freight",
           "script_name": "freight",
         },
       ],
     },
   }
   ```

2. Add the dependency:

   ```bash
   pnpm -F your-worker add '@repo/freight@workspace:*'
   ```

3. Add the binding to your context types and use it!
