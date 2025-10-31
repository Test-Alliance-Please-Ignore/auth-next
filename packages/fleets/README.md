# @repo/fleets

Shared types and interfaces for the Fleets Durable Object.

## Usage

Import this package in any worker that needs to interact with the Fleets Durable Object:

```typescript
import type { Fleets } from '@repo/fleets'
import { getStub } from '@repo/do-utils'

// Get a typed stub to the Durable Object
const stub = getStub<Fleets>(env.FLEETS, 'unique-id')

// Call RPC methods with full type safety
const result = await stub.exampleMethod('hello')
const state = await stub.getState()
```

## Adding to Your Worker

1. Add the dependency to your worker's `package.json`:

   ```bash
   pnpm -F your-worker add '@repo/fleets@workspace:*'
   ```

2. Add the Durable Object binding to your worker's `wrangler.jsonc`:

   ```jsonc
   {
     "durable_objects": {
       "bindings": [
         {
           "name": "FLEETS",
           "class_name": "Fleets",
           "script_name": "fleets",
         },
       ],
     },
   }
   ```

3. Add the binding to your worker's context types:
   ```typescript
   export type Env = SharedHonoEnv & {
     FLEETS: DurableObjectNamespace
   }
   ```
