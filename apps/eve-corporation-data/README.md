# eve-corporation-data

Cloudflare Worker with EveCorporationData Durable Object.

## Features

- **Durable Object**: SQLite-backed Durable Object with RPC support
- **WebSocket Support**: WebSocket hibernation API handlers
- **Database**: PostgreSQL with Drizzle ORM
- **Web Framework**: Hono
- **Testing**: Vitest with Cloudflare Workers pool

## Development

```bash
# Start development server
just dev -F eve-corporation-data

# Run tests
pnpm test

# Deploy
just deploy -F eve-corporation-data
```

## Database

```bash
# Generate migrations
just db-generate eve-corporation-data

# Run migrations
just db-migrate eve-corporation-data

# Push schema changes (dev only)
just db-push eve-corporation-data

# Open Drizzle Studio
just db-studio eve-corporation-data
```

## Using the Durable Object

The EveCorporationData Durable Object is available to this worker via the `EVE_CORPORATION_DATA` binding.

### From within this worker:

```typescript
import type { EveCorporationData } from '@repo/eve-corporation-data'
import { getStub } from '@repo/do-utils'

// Get a stub to the Durable Object
const stub = getStub<EveCorporationData>(c.env.EVE_CORPORATION_DATA, 'unique-id')

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
           "name": "EVE_CORPORATION_DATA",
           "class_name": "EveCorporationData",
           "script_name": "eve-corporation-data",
         },
       ],
     },
   }
   ```

2. Add the dependency:

   ```bash
   pnpm -F your-worker add '@repo/eve-corporation-data@workspace:*'
   ```

3. Add the binding to your context types and use it!
