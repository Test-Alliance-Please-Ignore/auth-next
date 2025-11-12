# universe

Cloudflare Worker with Universe Durable Object.

## Features

- **Durable Object**: SQLite-backed Durable Object with RPC support
- **WebSocket Support**: WebSocket hibernation API handlers
- **Database**: PostgreSQL with Drizzle ORM
- **Web Framework**: Hono
- **Testing**: Vitest with Cloudflare Workers pool

## Development

```bash
# Start development server
just dev -F universe

# Run tests
pnpm test

# Deploy
just deploy -F universe
```

## Database

```bash
# Generate migrations
just db-generate universe

# Run migrations
just db-migrate universe

# Push schema changes (dev only)
just db-push universe

# Open Drizzle Studio
just db-studio universe
```

## Using the Durable Object

The Universe Durable Object is available to this worker via the `UNIVERSE` binding.

### From within this worker:

```typescript
import { getStub } from '@repo/do-utils'

import type { Universe } from '@repo/universe'

// Get a stub to the Durable Object
const stub = getStub<Universe>(c.env.UNIVERSE, 'unique-id')

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
           "name": "UNIVERSE",
           "class_name": "Universe",
           "script_name": "universe",
         },
       ],
     },
   }
   ```

2. Add the dependency:

   ```bash
   pnpm -F your-worker add '@repo/universe@workspace:*'
   ```

3. Add the binding to your context types and use it!
