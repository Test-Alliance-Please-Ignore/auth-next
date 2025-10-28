# features

Cloudflare Worker with Features Durable Object.

## Features

- **Durable Object**: SQLite-backed Durable Object with RPC support
- **WebSocket Support**: WebSocket hibernation API handlers
- **Database**: PostgreSQL with Drizzle ORM
- **Web Framework**: Hono
- **Testing**: Vitest with Cloudflare Workers pool

## Development

```bash
# Start development server
just dev -F features

# Run tests
pnpm test

# Deploy
just deploy -F features
```

## Database

```bash
# Generate migrations
just db-generate features

# Run migrations
just db-migrate features

# Push schema changes (dev only)
just db-push features

# Open Drizzle Studio
just db-studio features
```

## Using the Durable Object

The Features Durable Object is available to this worker via the `FEATURES` binding.

### From within this worker:

```typescript
import type { Features } from '@repo/features'
import { getStub } from '@repo/do-utils'

// Get a stub to the Durable Object
const stub = getStub<Features>(c.env.FEATURES, 'unique-id')

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
           "name": "FEATURES",
           "class_name": "Features",
           "script_name": "features",
         },
       ],
     },
   }
   ```

2. Add the dependency:

   ```bash
   pnpm -F your-worker add '@repo/features@workspace:*'
   ```

3. Add the binding to your context types and use it!
