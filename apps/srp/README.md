# srp

Cloudflare Worker with Srp Durable Object.

## Features

- **Durable Object**: SQLite-backed Durable Object with RPC support
- **WebSocket Support**: WebSocket hibernation API handlers
- **Database**: PostgreSQL with Drizzle ORM
- **Web Framework**: Hono
- **Testing**: Vitest with Cloudflare Workers pool

## Development

```bash
# Start development server
just dev -F srp

# Run tests
pnpm test

# Deploy
just deploy -F srp
```

## Database

```bash
# Generate migrations
just db-generate srp

# Run migrations
just db-migrate srp

# Push schema changes (dev only)
just db-push srp

# Open Drizzle Studio
just db-studio srp
```

## Using the Durable Object

The Srp Durable Object is available to this worker via the `SRP` binding.

### From within this worker:

```typescript
import type { Srp } from '@repo/srp'
import { getStub } from '@repo/do-utils'

// Get a stub to the Durable Object
const stub = getStub<Srp>(c.env.SRP, 'unique-id')

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
           "name": "SRP",
           "class_name": "Srp",
           "script_name": "srp",
         },
       ],
     },
   }
   ```

2. Add the dependency:

   ```bash
   pnpm -F your-worker add '@repo/srp@workspace:*'
   ```

3. Add the binding to your context types and use it!
