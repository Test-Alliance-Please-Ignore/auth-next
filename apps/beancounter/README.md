# beancounter

Cloudflare Worker with Beancounter Durable Object.

## Features

- **Durable Object**: SQLite-backed Durable Object with RPC support
- **WebSocket Support**: WebSocket hibernation API handlers
- **Database**: PostgreSQL with Drizzle ORM
- **Web Framework**: Hono
- **Testing**: Vitest with Cloudflare Workers pool

## Development

```bash
# Start development server
just dev -F beancounter

# Run tests
pnpm test

# Deploy
just deploy -F beancounter
```

## Database

```bash
# Generate migrations
just db-generate beancounter

# Run migrations
just db-migrate beancounter

# Push schema changes (dev only)
just db-push beancounter

# Open Drizzle Studio
just db-studio beancounter
```

## Using the Durable Object

The Beancounter Durable Object is available to this worker via the `BEANCOUNTER` binding.

### From within this worker:

```typescript
import type { Beancounter } from '@repo/beancounter'
import { getStub } from '@repo/do-utils'

// Get a stub to the Durable Object
const stub = getStub<Beancounter>(c.env.BEANCOUNTER, 'unique-id')

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
           "name": "BEANCOUNTER",
           "class_name": "Beancounter",
           "script_name": "beancounter",
         },
       ],
     },
   }
   ```

2. Add the dependency:

   ```bash
   pnpm -F your-worker add '@repo/beancounter@workspace:*'
   ```

3. Add the binding to your context types and use it!
