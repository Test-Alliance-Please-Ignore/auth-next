# skills

Cloudflare Worker with Skills Durable Object.

## Features

- **Durable Object**: SQLite-backed Durable Object with RPC support
- **WebSocket Support**: WebSocket hibernation API handlers
- **Database**: PostgreSQL with Drizzle ORM
- **Web Framework**: Hono
- **Testing**: Vitest with Cloudflare Workers pool

## Development

```bash
# Start development server
just dev -F skills

# Run tests
pnpm test

# Deploy
just deploy -F skills
```

## Database

```bash
# Generate migrations
just db-generate skills

# Run migrations
just db-migrate skills

# Push schema changes (dev only)
just db-push skills

# Open Drizzle Studio
just db-studio skills
```

## Using the Durable Object

The Skills Durable Object is available to this worker via the `SKILLS` binding.

### From within this worker:

```typescript
import { getStub } from '@repo/do-utils'

import type { Skills } from '@repo/skills'

// Get a stub to the Durable Object
const stub = getStub<Skills>(c.env.SKILLS, 'unique-id')

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
           "name": "SKILLS",
           "class_name": "Skills",
           "script_name": "skills",
         },
       ],
     },
   }
   ```

2. Add the dependency:

   ```bash
   pnpm -F your-worker add '@repo/skills@workspace:*'
   ```

3. Add the binding to your context types and use it!
