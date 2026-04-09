/**
 * @repo/workflow-utils
 *
 * Shared utilities and helpers for building Cloudflare Workflows.
 * Provides context management, R2 intermediate storage, and step configuration.
 *
 * ## Quick Start
 *
 * ```typescript
 * import {
 *   createWorkflowContext,
 *   storeOrReturn,
 *   retrieveData,
 *   cleanupIntermediateData,
 *   defaultStepConfig,
 *   NonRetryableError,
 *   type WorkflowContext,
 *   type StepResult
 * } from '@repo/workflow-utils'
 *
 * // In workflow run() method
 * const ctx = createWorkflowContext<MyPayload>(
 *   'my-workflow',
 *   event,
 *   logger,
 *   env.MY_BUCKET
 * )
 *
 * // Store step output in R2
 * const result = await step.do('fetch-data', defaultStepConfig, async () => {
 *   const data = await fetchSomeData()
 *   return storeOrReturn(ctx, 'my-workflow-data', 'fetch-data', data)
 * })
 *
 * // Retrieve in later step
 * const data = await retrieveData(ctx, previousStepResult)
 *
 * // Cleanup at end
 * await cleanupIntermediateData(ctx, 'my-workflow-data')
 * ```
 */

// Types
export type { Logger, WorkflowContext, StepResult } from './types'

// Context factory
export { createWorkflowContext } from './types'

// Step config helpers
export {
	defaultStepConfig,
	strictStepConfig,
	lenientStepConfig,
	esiRetryOptions,
	esiFetchStepConfig,
	esiProcessingStepConfig,
} from './types'

// Error re-exports from cloudflare:workers
export { NonRetryableError } from './types'

// JSON utilities
export {
	jsonReplacer,
	safeJsonStringify,
	safeJsonParse,
	calculateJsonSize,
	shouldStoreInR2,
} from './json'

// ESI retry utilities (rate limit handling, permanent failure detection, backoff)
export {
	parseEsiErrorMetadata,
	extractEsiRateLimitSleepSeconds,
	isEsiRateLimitError,
	isPermanentEsiFailure,
	withJitter,
	withEsiRetryClassification,
	retryWithBackoff,
} from './esi-retry'

// Storage utilities
export {
	generateR2Key,
	storeInR2,
	storeOrReturn,
	retrieveFromR2,
	retrieveData,
	generateCleanupPrefix,
	cleanupIntermediateData,
} from './storage'
