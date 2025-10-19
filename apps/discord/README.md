# discord

Cloudflare Worker with Discord Durable Object.

## Features

- **Durable Object**: SQLite-backed Durable Object with RPC support
- **WebSocket Support**: WebSocket hibernation API handlers
- **Database**: PostgreSQL with Drizzle ORM
- **Web Framework**: Hono
- **Testing**: Vitest with Cloudflare Workers pool

## Development

```bash
# Start development server
just dev -F discord

# Run tests
pnpm test

# Deploy
just deploy -F discord
```

## Database

```bash
# Generate migrations
just db-generate discord

# Run migrations
just db-migrate discord

# Push schema changes (dev only)
just db-push discord

# Open Drizzle Studio
just db-studio discord
```

## Using the Durable Object

The Discord Durable Object is available to this worker via the `DISCORD` binding.

### From within this worker:

```typescript
import { getStub } from '@repo/do-utils'

import type { Discord } from '@repo/discord'

// Get a stub to the Durable Object
const stub = getStub<Discord>(c.env.DISCORD, 'unique-id')

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
           "name": "DISCORD",
           "class_name": "Discord",
           "script_name": "discord",
         },
       ],
     },
   }
   ```

2. Add the dependency:

   ```bash
   pnpm -F your-worker add '@repo/discord@workspace:*'
   ```

3. Add the binding to your context types and use it!
