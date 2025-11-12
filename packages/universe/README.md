# @repo/universe

Shared types and interfaces for the Universe Durable Object.

## Usage

Import this package in any worker that needs to interact with the Universe Durable Object:

```typescript
import { getStub } from '@repo/do-utils'

import type { Universe } from '@repo/universe'

// Get a typed stub to the Durable Object
const stub = getStub<Universe>(env.UNIVERSE, 'unique-id')

// Call RPC methods with full type safety
const result = await stub.exampleMethod('hello')
const state = await stub.getState()
```

## Adding to Your Worker

1. Add the dependency to your worker's `package.json`:

   ```bash
   pnpm -F your-worker add '@repo/universe@workspace:*'
   ```

2. Add the Durable Object binding to your worker's `wrangler.jsonc`:

   ```jsonc
   {
     "durable_objects": {
       "bindings": [
         {
           "name": "UNIVERSE",
           "class_name": "Universe",
           "script_name": "universe",
         },
       ],
     },
   }
   ```

3. Add the binding to your worker's context types:
   ```typescript
   export type Env = SharedHonoEnv & {
     UNIVERSE: DurableObjectNamespace
   }
   ```
