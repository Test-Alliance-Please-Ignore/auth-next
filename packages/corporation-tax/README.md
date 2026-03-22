# @repo/corporation-tax

Shared types and interfaces for the Corporation Tax Durable Object.

## Usage

Import this package in workers that need typed RPC access to corporation tax operations.

```ts
import { getStub } from '@repo/do-utils'

import type { CorporationTax } from '@repo/corporation-tax'

const stub = getStub<CorporationTax>(env.CORPORATION_TAX, 'default')
const health = await stub.getHealth()
```
