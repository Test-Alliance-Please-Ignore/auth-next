# @repo/doctrines

Shared types and interfaces for the Doctrines Durable Object.

## Usage

Import this package in any worker that needs to interact with the Doctrines Durable Object:

```typescript
import type { Doctrines } from '@repo/doctrines'
import { getStub } from '@repo/do-utils'

// Get a typed stub to the Durable Object
const stub = getStub<Doctrines>(env.DOCTRINES, 'unique-id')

// Call RPC methods with full type safety
const result = await stub.exampleMethod('hello')
const state = await stub.getState()
```

## Adding to Your Worker

1. Add the dependency to your worker's `package.json`:

   ```bash
   pnpm -F your-worker add '@repo/doctrines@workspace:*'
   ```

2. Add the Durable Object binding to your worker's `wrangler.jsonc`:

   ```jsonc
   {
     "durable_objects": {
       "bindings": [
         {
           "name": "DOCTRINES",
           "class_name": "Doctrines",
           "script_name": "doctrines",
         },
       ],
     },
   }
   ```

3. Add the binding to your worker's context types:
   ```typescript
   export type Env = SharedHonoEnv & {
     DOCTRINES: DurableObjectNamespace
   }
   ```
