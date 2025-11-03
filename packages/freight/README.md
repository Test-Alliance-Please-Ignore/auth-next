# @repo/freight

Shared types and interfaces for the Freight Durable Object.

## Usage

Import this package in any worker that needs to interact with the Freight Durable Object:

```typescript
import { getStub } from '@repo/do-utils'

import type { Freight } from '@repo/freight'

// Get a typed stub to the Durable Object
const stub = getStub<Freight>(env.FREIGHT, 'unique-id')

// Call RPC methods with full type safety
const result = await stub.exampleMethod('hello')
const state = await stub.getState()
```

## Adding to Your Worker

1. Add the dependency to your worker's `package.json`:

   ```bash
   pnpm -F your-worker add '@repo/freight@workspace:*'
   ```

2. Add the Durable Object binding to your worker's `wrangler.jsonc`:

   ```jsonc
   {
     "durable_objects": {
       "bindings": [
         {
           "name": "FREIGHT",
           "class_name": "Freight",
           "script_name": "freight",
         },
       ],
     },
   }
   ```

3. Add the binding to your worker's context types:
   ```typescript
   export type Env = SharedHonoEnv & {
     FREIGHT: DurableObjectNamespace
   }
   ```
