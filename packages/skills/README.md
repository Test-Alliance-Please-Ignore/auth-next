# @repo/skills

Shared types and interfaces for the Skills Durable Object.

## Usage

Import this package in any worker that needs to interact with the Skills Durable Object:

```typescript
import { getStub } from '@repo/do-utils'

import type { Skills } from '@repo/skills'

// Get a typed stub to the Durable Object
const stub = getStub<Skills>(env.SKILLS, 'unique-id')

// Call RPC methods with full type safety
const result = await stub.exampleMethod('hello')
const state = await stub.getState()
```

## Adding to Your Worker

1. Add the dependency to your worker's `package.json`:

   ```bash
   pnpm -F your-worker add '@repo/skills@workspace:*'
   ```

2. Add the Durable Object binding to your worker's `wrangler.jsonc`:

   ```jsonc
   {
     "durable_objects": {
       "bindings": [
         {
           "name": "SKILLS",
           "class_name": "Skills",
           "script_name": "skills",
         },
       ],
     },
   }
   ```

3. Add the binding to your worker's context types:
   ```typescript
   export type Env = SharedHonoEnv & {
     SKILLS: DurableObjectNamespace
   }
   ```
