# @repo/eve-corporation-data

Shared types and interfaces for the EveCorporationData Durable Object.

## Usage

Import this package in any worker that needs to interact with the EveCorporationData Durable Object:

```typescript
import type { EveCorporationData } from '@repo/eve-corporation-data'
import { getStub } from '@repo/do-utils'

// Get a typed stub to the Durable Object
const stub = getStub<EveCorporationData>(env.EVE_CORPORATION_DATA, 'unique-id')

// Call RPC methods with full type safety
const result = await stub.exampleMethod('hello')
const state = await stub.getState()
```

## Adding to Your Worker

1. Add the dependency to your worker's `package.json`:

   ```bash
   pnpm -F your-worker add '@repo/eve-corporation-data@workspace:*'
   ```

2. Add the Durable Object binding to your worker's `wrangler.jsonc`:

   ```jsonc
   {
     "durable_objects": {
       "bindings": [
         {
           "name": "EVE_CORPORATION_DATA",
           "class_name": "EveCorporationData",
           "script_name": "eve-corporation-data",
         },
       ],
     },
   }
   ```

3. Add the binding to your worker's context types:
   ```typescript
   export type Env = SharedHonoEnv & {
     EVE_CORPORATION_DATA: DurableObjectNamespace
   }
   ```
