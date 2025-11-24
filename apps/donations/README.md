# donations

Cloudflare Worker with Donations Durable Object.

## Features

- **Durable Object**: SQLite-backed Durable Object with RPC support
- **WebSocket Support**: WebSocket hibernation API handlers
- **Database**: PostgreSQL with Drizzle ORM
- **Web Framework**: Hono
- **Testing**: Vitest with Cloudflare Workers pool

## Development

```bash
# Start development server
just dev -F donations

# Run tests
pnpm test

# Deploy
just deploy -F donations
```

## Database

```bash
# Generate migrations
just db-generate donations

# Run migrations
just db-migrate donations

# Push schema changes (dev only)
just db-push donations

# Open Drizzle Studio
just db-studio donations
```

## Using the Durable Object

The Donations Durable Object is available to this worker via the `DONATIONS` binding.

### From within this worker:

```typescript
import type { Donations } from '@repo/donations'
import { getStub } from '@repo/do-utils'

// Get a stub to the Durable Object
const stub = getStub<Donations>(c.env.DONATIONS, 'unique-id')

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
           "name": "DONATIONS",
           "class_name": "Donations",
           "script_name": "donations",
         },
       ],
     },
   }
   ```

2. Add the dependency:

   ```bash
   pnpm -F your-worker add '@repo/donations@workspace:*'
   ```

3. Add the binding to your context types and use it!
