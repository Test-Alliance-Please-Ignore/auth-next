# @repo/{{ name }}

Shared types and interfaces for the {{ pascalCase name }} Durable Object.

## Usage

Import this package in any worker that needs to interact with the {{ pascalCase name }} Durable Object:

```typescript
import type { {{ pascalCase name }} } from '@repo/{{ name }}'
import { getStub } from '@repo/do-utils'

// Get a typed stub to the Durable Object
const stub = getStub<{{ pascalCase name }}>(env.{{ constantCase name }}, 'unique-id')

// Call RPC methods with full type safety
const result = await stub.exampleMethod('hello')
const state = await stub.getState()
```

## Adding to Your Worker

1. Add the dependency to your worker's `package.json`:

   ```bash
   pnpm -F your-worker add '@repo/{{ name }}@workspace:*'
   ```

2. Add the Durable Object binding to your worker's `wrangler.jsonc`:

   ```jsonc
   {
     "durable_objects": {
       "bindings": [
         {
           "name": "{{ constantCase name }}",
           "class_name": "{{ pascalCase name }}",
           "script_name": "{{ name }}",
         },
       ],
     },
   }
   ```

3. Add the binding to your worker's context types:
   ```typescript
   export type Env = SharedHonoEnv & {
     {{ constantCase name }}: DurableObjectNamespace
   }
   ```
