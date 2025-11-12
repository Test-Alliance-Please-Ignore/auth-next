# doctrines

Cloudflare Worker with Doctrines Durable Object.

## Features

- **Durable Object**: SQLite-backed Durable Object with RPC support
- **WebSocket Support**: WebSocket hibernation API handlers
- **Database**: PostgreSQL with Drizzle ORM
- **Web Framework**: Hono
- **Testing**: Vitest with Cloudflare Workers pool

## Development

```bash
# Start development server
just dev -F doctrines

# Run tests
pnpm test

# Deploy
just deploy -F doctrines
```

## Database

```bash
# Generate migrations
just db-generate doctrines

# Run migrations
just db-migrate doctrines

# Push schema changes (dev only)
just db-push doctrines

# Open Drizzle Studio
just db-studio doctrines
```

## Using the Durable Object

The Doctrines Durable Object is available to this worker via the `DOCTRINES` binding.

### From within this worker:

```typescript
import { getStub } from '@repo/do-utils'

import type { Doctrines } from '@repo/doctrines'

// Get a stub to the Durable Object
const stub = getStub<Doctrines>(c.env.DOCTRINES, 'unique-id')

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
           "name": "DOCTRINES",
           "class_name": "Doctrines",
           "script_name": "doctrines",
         },
       ],
     },
   }
   ```

2. Add the dependency:

   ```bash
   pnpm -F your-worker add '@repo/doctrines@workspace:*'
   ```

3. Add the binding to your context types and use it!
