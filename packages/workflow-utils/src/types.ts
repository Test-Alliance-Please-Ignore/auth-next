/**
 * Workflow types, context, and configuration helpers
 */

import type { WorkflowEvent, WorkflowStepConfig } from 'cloudflare:workers'
import type { logger } from '@repo/hono-helpers'

/**
 * Logger type from @repo/hono-helpers
 */
export type Logger = typeof logger

/**
 * Base context type for workflow steps
 * Generic over the payload type for type-safe access
 */
export interface WorkflowContext<TPayload = unknown> {
	/** Structured logger from @repo/hono-helpers */
	logger: Logger
	/** Identifier for the workflow type */
	workflowName: string
	/** Unique instance ID from WorkflowEvent.instanceId */
	workflowInstanceId: string
	/** When the workflow was triggered (from WorkflowEvent.timestamp) */
	timestamp: Date
	/** Workflow-specific payload from WorkflowEvent.payload */
	payload: TPayload
	/** Optional R2 bucket for intermediate storage */
	bucket?: R2Bucket
}

/**
 * Factory function to create a WorkflowContext from a WorkflowEvent
 *
 * @param workflowName - Identifier for the workflow type
 * @param event - The WorkflowEvent passed to run()
 * @param logger - Logger instance from @repo/hono-helpers
 * @param bucket - Optional R2 bucket for intermediate storage
 * @returns A fully typed WorkflowContext
 *
 * @example
 * ```typescript
 * const ctx = createWorkflowContext<MyPayload>(
 *   'my-workflow',
 *   event,
 *   logger,
 *   env.MY_BUCKET
 * )
 * ```
 */
export function createWorkflowContext<TPayload = unknown>(
	workflowName: string,
	event: WorkflowEvent<TPayload>,
	logger: Logger,
	bucket?: R2Bucket
): WorkflowContext<TPayload> {
	return {
		logger,
		workflowName,
		workflowInstanceId: event.instanceId,
		timestamp: event.timestamp,
		payload: event.payload,
		bucket,
	}
}

/**
 * Result type that indicates where data is stored
 * Used to track step outputs that may be in memory or R2
 */
export type StepResult<T = unknown> =
	| { source: 'payload'; success: true; data: T }
	| { source: 'r2'; success: true; r2Key: string }
	| { source: 'none'; success: false; error: string }

// Re-export NonRetryableError for terminal errors that shouldn't retry
export { NonRetryableError } from 'cloudflare:workflows'

/**
 * Default step config with sensible retries
 * 3 retries with exponential backoff, 5 minute timeout
 */
export const defaultStepConfig: WorkflowStepConfig = {
	retries: { limit: 3, backoff: 'exponential', delay: '1 second' },
	timeout: '5 minutes',
}

/**
 * Strict config for critical operations
 * Fewer retries (1), shorter timeout (2 minutes)
 * Use for operations where failure should fail fast
 */
export const strictStepConfig: WorkflowStepConfig = {
	retries: { limit: 1, backoff: 'exponential', delay: '1 second' },
	timeout: '2 minutes',
}

/**
 * Lenient config for resilient services
 * More retries (5), longer delays, 10 minute timeout
 * Use for external services that may be temporarily unavailable
 */
export const lenientStepConfig: WorkflowStepConfig = {
	retries: { limit: 5, backoff: 'exponential', delay: '5 seconds' },
	timeout: '10 minutes',
}
