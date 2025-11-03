# @repo/markets

Shared types and interfaces for the Markets Durable Object.

## Usage

Import this package in any worker that needs to interact with the Markets Durable Object:

```typescript
import { getStub } from '@repo/do-utils'

import type { Markets } from '@repo/markets'

// Get a typed stub to the Durable Object
const stub = getStub<Markets>(env.MARKETS, 'unique-id')

// Call RPC methods with full type safety
const result = await stub.exampleMethod('hello')
const state = await stub.getState()
```

## Adding to Your Worker

1. Add the dependency to your worker's `package.json`:

   ```bash
   pnpm -F your-worker add '@repo/markets@workspace:*'
   ```

2. Add the Durable Object binding to your worker's `wrangler.jsonc`:

   ```jsonc
   {
     "durable_objects": {
       "bindings": [
         {
           "name": "MARKETS",
           "class_name": "Markets",
           "script_name": "markets",
         },
       ],
     },
   }
   ```

3. Add the binding to your worker's context types:
   ```typescript
   export type Env = SharedHonoEnv & {
     MARKETS: DurableObjectNamespace
   }
   ```
