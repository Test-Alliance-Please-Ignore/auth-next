# @repo/broadcasts

Shared types and interfaces for the Broadcasts Durable Object.

## Usage

Import this package in any worker that needs to interact with the Broadcasts Durable Object:

```typescript
import type { Broadcasts } from '@repo/broadcasts'
import { getStub } from '@repo/do-utils'

// Get a typed stub to the Durable Object
const stub = getStub<Broadcasts>(env.BROADCASTS, 'unique-id')

// Call RPC methods with full type safety
const result = await stub.exampleMethod('hello')
const state = await stub.getState()
```

## Adding to Your Worker

1. Add the dependency to your worker's `package.json`:

   ```bash
   pnpm -F your-worker add '@repo/broadcasts@workspace:*'
   ```

2. Add the Durable Object binding to your worker's `wrangler.jsonc`:

   ```jsonc
   {
     "durable_objects": {
       "bindings": [
         {
           "name": "BROADCASTS",
           "class_name": "Broadcasts",
           "script_name": "broadcasts",
         },
       ],
     },
   }
   ```

3. Add the binding to your worker's context types:
   ```typescript
   export type Env = SharedHonoEnv & {
     BROADCASTS: DurableObjectNamespace
   }
   ```
