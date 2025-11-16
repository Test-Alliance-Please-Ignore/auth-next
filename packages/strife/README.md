# @repo/strife

Shared types and interfaces for the Strife Durable Object.

## Usage

Import this package in any worker that needs to interact with the Strife Durable Object:

```typescript
import type { Strife } from '@repo/strife'
import { getStub } from '@repo/do-utils'

// Get a typed stub to the Durable Object
const stub = getStub<Strife>(env.STRIFE, 'unique-id')

// Call RPC methods with full type safety
const result = await stub.exampleMethod('hello')
const state = await stub.getState()
```

## Adding to Your Worker

1. Add the dependency to your worker's `package.json`:

   ```bash
   pnpm -F your-worker add '@repo/strife@workspace:*'
   ```

2. Add the Durable Object binding to your worker's `wrangler.jsonc`:

   ```jsonc
   {
     "durable_objects": {
       "bindings": [
         {
           "name": "STRIFE",
           "class_name": "Strife",
           "script_name": "strife",
         },
       ],
     },
   }
   ```

3. Add the binding to your worker's context types:
   ```typescript
   export type Env = SharedHonoEnv & {
     STRIFE: DurableObjectNamespace
   }
   ```
