# @repo/workflow-utils

Shared utilities and helpers for building Cloudflare Workflows. Provides context management, R2 intermediate storage, and step configuration helpers.

## Installation

This is an internal workspace package. Add it to your worker:

```bash
pnpm -F your-worker add '@repo/workflow-utils@workspace:*'
```

## Features

- **WorkflowContext** - Centralized context object for workflow state
- **R2 Storage** - Store and retrieve intermediate step data in R2
- **Step Configs** - Pre-built retry and timeout configurations
- **JSON Utilities** - Safe serialization with BigInt and Date support
- **NonRetryableError** - Re-exported for terminal error handling

## Quick Start

```typescript
import {
  createWorkflowContext,
  storeOrReturn,
  retrieveData,
  cleanupIntermediateData,
  defaultStepConfig,
  NonRetryableError,
  type WorkflowContext,
  type StepResult
} from '@repo/workflow-utils'

export class MyWorkflow extends WorkflowEntrypoint<Env, MyPayload> {
  async run(event: WorkflowEvent<MyPayload>, step: WorkflowStep) {
    // Create context once at the start
    const ctx = createWorkflowContext<MyPayload>(
      'my-workflow',
      event,
      logger,
      this.env.MY_BUCKET
    )

    // Step 1: Fetch and store data
    const fetchResult = await step.do('fetch-data', defaultStepConfig, async () => {
      const data = await fetchSomeData()
      return storeOrReturn(ctx, 'my-workflow-data', 'fetch-data', data)
    })

    // Step 2: Process data from previous step
    const processResult = await step.do('process-data', defaultStepConfig, async () => {
      const data = await retrieveData(ctx, fetchResult)
      if (!data) {
        throw new NonRetryableError('Data not found')
      }
      const processed = await processData(data)
      return storeOrReturn(ctx, 'my-workflow-data', 'process-data', processed)
    })

    // Final step: Cleanup intermediate data
    await step.do('cleanup', async () => {
      await cleanupIntermediateData(ctx, 'my-workflow-data')
    })

    return { success: true }
  }
}
```

## API Reference

### Context

#### `createWorkflowContext<TPayload>(workflowName, event, logger, bucket?)`

Creates a WorkflowContext from a WorkflowEvent.

```typescript
const ctx = createWorkflowContext<MyPayload>(
  'my-workflow',
  event,
  logger,
  env.MY_BUCKET
)
```

#### `WorkflowContext<TPayload>`

```typescript
interface WorkflowContext<TPayload = unknown> {
  logger: Logger
  workflowName: string
  workflowInstanceId: string
  timestamp: Date
  payload: TPayload
  bucket?: R2Bucket
}
```

### Storage

#### `storeOrReturn(ctx, prefix, stepId, data)`

Stores data in R2 and returns a StepResult with the R2 key.

#### `retrieveData(ctx, result)`

Retrieves data from a StepResult (handles both payload and R2 sources).

#### `cleanupIntermediateData(ctx, prefix)`

Deletes all intermediate data for the workflow instance.

### Step Configs

- `defaultStepConfig` - 3 retries, exponential backoff, 5 min timeout
- `strictStepConfig` - 1 retry, 2 min timeout (fail fast)
- `lenientStepConfig` - 5 retries, 10 min timeout (resilient services)

### JSON Utilities

- `safeJsonStringify(data)` - Handles BigInt and Date serialization
- `safeJsonParse<T>(json)` - Type-safe JSON parsing
- `calculateJsonSize(data)` - Calculate byte size
- `shouldStoreInR2(sizeBytes)` - Check if > 1 MiB

### Errors

- `NonRetryableError` - Re-exported from cloudflare:workers for terminal errors

## Development

```bash
# Run type checking
pnpm check:types

# Run linting
pnpm check:lint

# Run tests
pnpm test
```
