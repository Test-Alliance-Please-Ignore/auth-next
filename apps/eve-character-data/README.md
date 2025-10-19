# eve-character-data

Cloudflare Worker with EveCharacterData Durable Object.

## Features

- **Durable Object**: SQLite-backed Durable Object with RPC support
- **WebSocket Support**: WebSocket hibernation API handlers
- **Database**: PostgreSQL with Drizzle ORM
- **Web Framework**: Hono
- **Testing**: Vitest with Cloudflare Workers pool

## Development

```bash
# Start development server
just dev -F eve-character-data

# Run tests
pnpm test

# Deploy
just deploy -F eve-character-data
```

## Database

```bash
# Generate migrations
just db-generate eve-character-data

# Run migrations
just db-migrate eve-character-data

# Push schema changes (dev only)
just db-push eve-character-data

# Open Drizzle Studio
just db-studio eve-character-data
```

## Using the Durable Object

The EveCharacterData Durable Object is available to this worker via the `EVE_CHARACTER_DATA` binding.

### From within this worker:

```typescript
import type { EveCharacterData } from '@repo/eve-character-data'
import { getStub } from '@repo/do-utils'

// Get a stub to the Durable Object
const stub = getStub<EveCharacterData>(c.env.EVE_CHARACTER_DATA, 'unique-id')

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
           "name": "EVE_CHARACTER_DATA",
           "class_name": "EveCharacterData",
           "script_name": "eve-character-data"
         }
       ]
     }
   }
   ```

2. Add the dependency:
   ```bash
   pnpm -F your-worker add '@repo/eve-character-data@workspace:*'
   ```

3. Add the binding to your context types and use it!
