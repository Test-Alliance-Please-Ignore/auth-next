# {{ name }}

Cloudflare Worker with {{ pascalCase name }} Durable Object.

## Features

- **Durable Object**: SQLite-backed Durable Object with RPC support
- **WebSocket Support**: WebSocket hibernation API handlers
- **Database**: PostgreSQL with Drizzle ORM
- **Web Framework**: Hono
- **Testing**: Vitest with Cloudflare Workers pool

## Development

```bash
# Start development server
just dev -F {{ name }}

# Run tests
pnpm test

# Deploy
just deploy -F {{ name }}
```

## Database

```bash
# Generate migrations
just db-generate {{ name }}

# Run migrations
just db-migrate {{ name }}

# Push schema changes (dev only)
just db-push {{ name }}

# Open Drizzle Studio
just db-studio {{ name }}
```

## Using the Durable Object

The {{ pascalCase name }} Durable Object is available to this worker via the `{{ constantCase name }}` binding.

### From within this worker:

```typescript
import type { {{ pascalCase name }} } from '@repo/{{ name }}'
import { getStub } from '@repo/do-utils'

// Get a stub to the Durable Object
const stub = getStub<{{ pascalCase name }}>(c.env.{{ constantCase name }}, 'unique-id')

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
           "name": "{{ constantCase name }}",
           "class_name": "{{ pascalCase name }}",
           "script_name": "{{ name }}"
         }
       ]
     }
   }
   ```

2. Add the dependency:
   ```bash
   pnpm -F your-worker add '@repo/{{ name }}@workspace:*'
   ```

3. Add the binding to your context types and use it!
