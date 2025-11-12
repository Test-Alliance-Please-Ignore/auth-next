# @repo/srp

Shared types and interfaces for the Srp Durable Object.

## Usage

Import this package in any worker that needs to interact with the Srp Durable Object:

```typescript
import { getStub } from '@repo/do-utils'

import type { Srp } from '@repo/srp'

// Get a typed stub to the Durable Object
const stub = getStub<Srp>(env.SRP, 'unique-id')

// Call RPC methods with full type safety
const result = await stub.exampleMethod('hello')
const state = await stub.getState()
```

## Adding to Your Worker

1. Add the dependency to your worker's `package.json`:

   ```bash
   pnpm -F your-worker add '@repo/srp@workspace:*'
   ```

2. Add the Durable Object binding to your worker's `wrangler.jsonc`:

   ```jsonc
   {
     "durable_objects": {
       "bindings": [
         {
           "name": "SRP",
           "class_name": "Srp",
           "script_name": "srp",
         },
       ],
     },
   }
   ```

3. Add the binding to your worker's context types:
   ```typescript
   export type Env = SharedHonoEnv & {
     SRP: DurableObjectNamespace
   }
   ```
