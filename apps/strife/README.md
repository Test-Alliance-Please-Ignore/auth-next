# strife

Cloudflare Worker with Strife Durable Object.

## Features

- **Durable Object**: SQLite-backed Durable Object with RPC support
- **WebSocket Support**: WebSocket hibernation API handlers
- **Database**: PostgreSQL with Drizzle ORM
- **Web Framework**: Hono
- **Testing**: Vitest with Cloudflare Workers pool

## Development

```bash
# Start development server
just dev -F strife

# Run tests
pnpm test

# Deploy
just deploy -F strife
```

## Database

```bash
# Generate migrations
just db-generate strife

# Run migrations
just db-migrate strife

# Push schema changes (dev only)
just db-push strife

# Open Drizzle Studio
just db-studio strife
```

## Using the Durable Object

The Strife Durable Object is available to this worker via the `STRIFE` binding.

### From within this worker:

```typescript
import type { Strife } from '@repo/strife'
import { getStub } from '@repo/do-utils'

// Get a stub to the Durable Object
const stub = getStub<Strife>(c.env.STRIFE, 'unique-id')

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
           "name": "STRIFE",
           "class_name": "Strife",
           "script_name": "strife",
         },
       ],
     },
   }
   ```

2. Add the dependency:

   ```bash
   pnpm -F your-worker add '@repo/strife@workspace:*'
   ```

3. Add the binding to your context types and use it!
