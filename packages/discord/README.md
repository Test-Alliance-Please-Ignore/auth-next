# @repo/discord

Shared types and interfaces for the Discord Durable Object.

## Usage

Import this package in any worker that needs to interact with the Discord Durable Object:

```typescript
import { getStub } from '@repo/do-utils'

import type { Discord } from '@repo/discord'

// Get a typed stub to the Durable Object
const stub = getStub<Discord>(env.DISCORD, 'unique-id')

// Call RPC methods with full type safety
const result = await stub.exampleMethod('hello')
const state = await stub.getState()
```

## Adding to Your Worker

1. Add the dependency to your worker's `package.json`:

   ```bash
   pnpm -F your-worker add '@repo/discord@workspace:*'
   ```

2. Add the Durable Object binding to your worker's `wrangler.jsonc`:

   ```jsonc
   {
     "durable_objects": {
       "bindings": [
         {
           "name": "DISCORD",
           "class_name": "Discord",
           "script_name": "discord",
         },
       ],
     },
   }
   ```

3. Add the binding to your worker's context types:
   ```typescript
   export type Env = SharedHonoEnv & {
     DISCORD: DurableObjectNamespace
   }
   ```
