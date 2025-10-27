# @repo/bills

Shared types and interfaces for the Bills Durable Object.

## Usage

Import this package in any worker that needs to interact with the Bills Durable Object:

```typescript
import type { Bills } from '@repo/bills'
import { getStub } from '@repo/do-utils'

// Get a typed stub to the Durable Object
const stub = getStub<Bills>(env.BILLS, 'unique-id')

// Call RPC methods with full type safety
const result = await stub.exampleMethod('hello')
const state = await stub.getState()
```

## Adding to Your Worker

1. Add the dependency to your worker's `package.json`:

   ```bash
   pnpm -F your-worker add '@repo/bills@workspace:*'
   ```

2. Add the Durable Object binding to your worker's `wrangler.jsonc`:

   ```jsonc
   {
     "durable_objects": {
       "bindings": [
         {
           "name": "BILLS",
           "class_name": "Bills",
           "script_name": "bills",
         },
       ],
     },
   }
   ```

3. Add the binding to your worker's context types:
   ```typescript
   export type Env = SharedHonoEnv & {
     BILLS: DurableObjectNamespace
   }
   ```
