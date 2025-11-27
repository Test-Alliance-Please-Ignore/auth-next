# mumble

Cloudflare Worker with Mumble Durable Object.

## Features

- **Durable Object**: SQLite-backed Durable Object with RPC support
- **WebSocket Support**: WebSocket hibernation API handlers
- **Database**: PostgreSQL with Drizzle ORM
- **Web Framework**: Hono
- **Testing**: Vitest with Cloudflare Workers pool

## Development

```bash
# Start development server
just dev -F mumble

# Run tests
pnpm test

# Deploy
just deploy -F mumble
```

## Database

```bash
# Generate migrations
just db-generate mumble

# Run migrations
just db-migrate mumble

# Push schema changes (dev only)
just db-push mumble

# Open Drizzle Studio
just db-studio mumble
```

## Using the Durable Object

The Mumble Durable Object is available to this worker via the `MUMBLE` binding.

### From within this worker:

```typescript
import type { Mumble } from '@repo/mumble'
import { getStub } from '@repo/do-utils'

// Get a stub to the Durable Object
const stub = getStub<Mumble>(c.env.MUMBLE, 'unique-id')

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
           "name": "MUMBLE",
           "class_name": "Mumble",
           "script_name": "mumble",
         },
       ],
     },
   }
   ```

2. Add the dependency:

   ```bash
   pnpm -F your-worker add '@repo/mumble@workspace:*'
   ```

3. Add the binding to your context types and use it!
