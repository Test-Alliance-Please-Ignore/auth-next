# postman

Cloudflare Worker with Postman Durable Object.

## Features

- **Durable Object**: SQLite-backed Durable Object with RPC support
- **WebSocket Support**: WebSocket hibernation API handlers
- **Database**: PostgreSQL with Drizzle ORM
- **Web Framework**: Hono
- **Testing**: Vitest with Cloudflare Workers pool

## Development

```bash
# Start development server
just dev -F postman

# Run tests
pnpm test

# Deploy
just deploy -F postman
```

## Database

```bash
# Generate migrations
just db-generate postman

# Run migrations
just db-migrate postman

# Push schema changes (dev only)
just db-push postman

# Open Drizzle Studio
just db-studio postman
```

## Using the Durable Object

The Postman Durable Object is available to this worker via the `POSTMAN` binding.

### From within this worker:

```typescript
import type { Postman } from '@repo/postman'
import { getStub } from '@repo/do-utils'

// Get a stub to the Durable Object
const stub = getStub<Postman>(c.env.POSTMAN, 'unique-id')

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
           "name": "POSTMAN",
           "class_name": "Postman",
           "script_name": "postman",
         },
       ],
     },
   }
   ```

2. Add the dependency:

   ```bash
   pnpm -F your-worker add '@repo/postman@workspace:*'
   ```

3. Add the binding to your context types and use it!
