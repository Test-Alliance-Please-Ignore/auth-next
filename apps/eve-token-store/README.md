# eve-token-store

Cloudflare Worker with EveTokenStore Durable Object.

## Features

- **Durable Object**: SQLite-backed Durable Object with RPC support
- **WebSocket Support**: WebSocket hibernation API handlers
- **Database**: PostgreSQL with Drizzle ORM
- **Web Framework**: Hono
- **Testing**: Vitest with Cloudflare Workers pool

## Development

```bash
# Start development server
just dev -F eve-token-store

# Run tests
pnpm test

# Deploy
just deploy -F eve-token-store
```

## Database

```bash
# Generate migrations
just db-generate eve-token-store

# Run migrations
just db-migrate eve-token-store

# Push schema changes (dev only)
just db-push eve-token-store

# Open Drizzle Studio
just db-studio eve-token-store
```

## Using the Durable Object

The EveTokenStore Durable Object is available to this worker via the `EVE_TOKEN_STORE` binding.

### From within this worker:

```typescript
import type { EveTokenStore } from '@repo/eve-token-store'
import { getStub } from '@repo/do-utils'

// Get a stub to the Durable Object
const stub = getStub<EveTokenStore>(c.env.EVE_TOKEN_STORE, 'unique-id')

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
           "name": "EVE_TOKEN_STORE",
           "class_name": "EveTokenStore",
           "script_name": "eve-token-store"
         }
       ]
     }
   }
   ```

2. Add the dependency:
   ```bash
   pnpm -F your-worker add '@repo/eve-token-store@workspace:*'
   ```

3. Add the binding to your context types and use it!
