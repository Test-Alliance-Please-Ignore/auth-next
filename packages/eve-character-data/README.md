# @repo/eve-character-data

Shared types and interfaces for the EveCharacterData Durable Object.

## Usage

Import this package in any worker that needs to interact with the EveCharacterData Durable Object:

```typescript
import type { EveCharacterData } from '@repo/eve-character-data'
import { getStub } from '@repo/do-utils'

// Get a typed stub to the Durable Object
const stub = getStub<EveCharacterData>(env.EVE_CHARACTER_DATA, 'unique-id')

// Call RPC methods with full type safety
const result = await stub.exampleMethod('hello')
const state = await stub.getState()
```

## Adding to Your Worker

1. Add the dependency to your worker's `package.json`:
   ```bash
   pnpm -F your-worker add '@repo/eve-character-data@workspace:*'
   ```

2. Add the Durable Object binding to your worker's `wrangler.jsonc`:
   ```jsonc
   {
     "durable_objects": {
       "bindings": [
         {
           "name": "EVE_CHARACTER_DATA",
           "class_name": "EveCharacterData",
           "script_name": "eve-character-data"
         }
       ]
     }
   }
   ```

3. Add the binding to your worker's context types:
   ```typescript
   export type Env = SharedHonoEnv & {
     EVE_CHARACTER_DATA: DurableObjectNamespace
   }
   ```
