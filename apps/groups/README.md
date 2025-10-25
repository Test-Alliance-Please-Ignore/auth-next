# groups

Cloudflare Worker with Groups Durable Object.

## Features

- **Durable Object**: SQLite-backed Durable Object with RPC support
- **WebSocket Support**: WebSocket hibernation API handlers
- **Database**: PostgreSQL with Drizzle ORM
- **Web Framework**: Hono
- **Testing**: Vitest with Cloudflare Workers pool

## Development

```bash
# Start development server
just dev -F groups

# Run tests
pnpm test

# Deploy
just deploy -F groups
```

## Database

```bash
# Generate migrations
just db-generate groups

# Run migrations
just db-migrate groups

# Push schema changes (dev only)
just db-push groups

# Open Drizzle Studio
just db-studio groups
```

## Using the Durable Object

The Groups Durable Object is available to this worker via the `GROUPS` binding.

### From within this worker:

```typescript
import { getStub } from '@repo/do-utils'

import type { Groups } from '@repo/groups'

// Get a stub to the Durable Object
const stub = getStub<Groups>(c.env.GROUPS, 'unique-id')

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
           "name": "GROUPS",
           "class_name": "Groups",
           "script_name": "groups",
         },
       ],
     },
   }
   ```

2. Add the dependency:

   ```bash
   pnpm -F your-worker add '@repo/groups@workspace:*'
   ```

3. Add the binding to your context types and use it!
