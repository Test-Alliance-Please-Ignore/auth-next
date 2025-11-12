# industry

Cloudflare Worker with Industry Durable Object.

## Features

- **Durable Object**: SQLite-backed Durable Object with RPC support
- **WebSocket Support**: WebSocket hibernation API handlers
- **Database**: PostgreSQL with Drizzle ORM
- **Web Framework**: Hono
- **Testing**: Vitest with Cloudflare Workers pool

## Development

```bash
# Start development server
just dev -F industry

# Run tests
pnpm test

# Deploy
just deploy -F industry
```

## Database

```bash
# Generate migrations
just db-generate industry

# Run migrations
just db-migrate industry

# Push schema changes (dev only)
just db-push industry

# Open Drizzle Studio
just db-studio industry
```

## Using the Durable Object

The Industry Durable Object is available to this worker via the `INDUSTRY` binding.

### From within this worker:

```typescript
import { getStub } from '@repo/do-utils'

import type { Industry } from '@repo/industry'

// Get a stub to the Durable Object
const stub = getStub<Industry>(c.env.INDUSTRY, 'unique-id')

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
           "name": "INDUSTRY",
           "class_name": "Industry",
           "script_name": "industry",
         },
       ],
     },
   }
   ```

2. Add the dependency:

   ```bash
   pnpm -F your-worker add '@repo/industry@workspace:*'
   ```

3. Add the binding to your context types and use it!
