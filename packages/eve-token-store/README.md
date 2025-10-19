# @repo/eve-token-store

Shared types and interfaces for the EveTokenStore Durable Object.

## Usage

Import this package in any worker that needs to interact with the EveTokenStore Durable Object:

```typescript
import type { EveTokenStore } from '@repo/eve-token-store'
import { getStub } from '@repo/do-utils'

// Get a typed stub to the Durable Object
const stub = getStub<EveTokenStore>(env.EVE_TOKEN_STORE, 'unique-id')

// Call RPC methods with full type safety
const result = await stub.exampleMethod('hello')
const state = await stub.getState()
```

## Adding to Your Worker

1. Add the dependency to your worker's `package.json`:
   ```bash
   pnpm -F your-worker add '@repo/eve-token-store@workspace:*'
   ```

2. Add the Durable Object binding to your worker's `wrangler.jsonc`:
   ```jsonc
   {
     "durable_objects": {
       "bindings": [
         {
           "name": "EVE_TOKEN_STORE",
           "class_name": "EveTokenStore",
           "script_name": "eve-token-store"
         }
       ]
     }
   }
   ```

3. Add the binding to your worker's context types:
   ```typescript
   export type Env = SharedHonoEnv & {
     EVE_TOKEN_STORE: DurableObjectNamespace
   }
   ```
