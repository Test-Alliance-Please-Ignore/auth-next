# hr

Cloudflare Worker with Hr Durable Object.

## Features

- **Durable Object**: SQLite-backed Durable Object with RPC support
- **WebSocket Support**: WebSocket hibernation API handlers
- **Database**: PostgreSQL with Drizzle ORM
- **Web Framework**: Hono
- **Testing**: Vitest with Cloudflare Workers pool

## Development

```bash
# Start development server
just dev -F hr

# Run tests
pnpm test

# Deploy
just deploy -F hr
```

## Database

```bash
# Generate migrations
just db-generate hr

# Run migrations
just db-migrate hr

# Push schema changes (dev only)
just db-push hr

# Open Drizzle Studio
just db-studio hr
```

## Using the Durable Object

The Hr Durable Object is available to this worker via the `HR` binding.

### From within this worker:

```typescript
import type { Hr } from '@repo/hr'
import { getStub } from '@repo/do-utils'

// Get a stub to the Durable Object
const stub = getStub<Hr>(c.env.HR, 'unique-id')

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
           "name": "HR",
           "class_name": "Hr",
           "script_name": "hr",
         },
       ],
     },
   }
   ```

2. Add the dependency:

   ```bash
   pnpm -F your-worker add '@repo/hr@workspace:*'
   ```

3. Add the binding to your context types and use it!
