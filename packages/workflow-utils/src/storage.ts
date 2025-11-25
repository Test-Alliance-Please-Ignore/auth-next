/**
 * R2 storage utilities for workflow intermediate step data
 * All step outputs are stored in R2 to enable later steps to access previous outputs
 */

import { safeJsonParse, safeJsonStringify } from './json'

import type { StepResult, WorkflowContext } from './types'

/**
 * Generate R2 key for intermediate data
 * Pure function - no side effects
 *
 * @param prefix - Custom prefix for the R2 path (e.g., 'my-workflow-data')
 * @param workflowInstanceId - Unique workflow instance ID
 * @param stepId - Step identifier
 * @returns R2 key in format: `{prefix}/{workflowInstanceId}/{stepId}.json`
 */
export function generateR2Key(prefix: string, workflowInstanceId: string, stepId: string): string {
	const base = prefix ? `${prefix}/` : ''
	return `${base}${workflowInstanceId}/${stepId}.json`
}

/**
 * Store data in R2
 * Low-level function with injectable bucket dependency for testability
 *
 * @param bucket - R2 bucket to store data in
 * @param key - R2 object key
 * @param data - Data to serialize and store
 */
export async function storeInR2(bucket: R2Bucket, key: string, data: unknown): Promise<void> {
	const json = safeJsonStringify(data)
	await bucket.put(key, json)
}

/**
 * Store data in R2 and return a StepResult
 * Uses WorkflowContext for bucket and instanceId to reduce parameter repetition
 *
 * @param ctx - WorkflowContext with bucket and workflowInstanceId
 * @param prefix - Custom prefix for the R2 path
 * @param stepId - Step identifier for this data
 * @param data - Data to store
 * @returns StepResult with R2 location reference
 * @throws Error if ctx.bucket is undefined
 *
 * @example
 * ```typescript
 * const result = await storeOrReturn(ctx, 'my-workflow-data', 'fetch-users', userData)
 * ```
 */
export async function storeOrReturn<T>(
	ctx: WorkflowContext,
	prefix: string,
	stepId: string,
	data: T,
): Promise<StepResult<T>> {
	if (!ctx.bucket) {
		throw new Error('WorkflowContext.bucket is required for storeOrReturn')
	}

	const r2Key = generateR2Key(prefix, ctx.workflowInstanceId, stepId)
	await storeInR2(ctx.bucket, r2Key, data)
	return { source: 'r2', success: true, r2Key }
}

/**
 * Retrieve data from R2
 * Low-level function with injectable bucket dependency for testability
 *
 * @param bucket - R2 bucket to retrieve from
 * @param key - R2 object key
 * @returns Parsed data from R2
 * @throws Error if object not found
 */
export async function retrieveFromR2<T>(bucket: R2Bucket, key: string): Promise<T> {
	const obj = await bucket.get(key)
	if (!obj) {
		throw new Error(`Object not found in R2: ${key}`)
	}
	const json = await obj.text()
	return safeJsonParse<T>(json)
}

/**
 * Retrieve data from a StepResult
 * Uses WorkflowContext for bucket access
 * Handles both payload and R2 storage sources
 *
 * @param ctx - WorkflowContext with bucket
 * @param result - StepResult from previous step
 * @returns Data or null if unsuccessful
 * @throws Error if ctx.bucket is undefined and result is R2-sourced
 *
 * @example
 * ```typescript
 * const data = await retrieveData(ctx, previousStepResult)
 * if (!data) {
 *   throw new NonRetryableError('Data not found')
 * }
 * ```
 */
export async function retrieveData<T>(
	ctx: WorkflowContext,
	result: StepResult<T>,
): Promise<T | null> {
	if (!result.success) {
		return null
	}

	if (result.source === 'payload') {
		return result.data
	}

	if (result.source === 'r2') {
		if (!ctx.bucket) {
			throw new Error('WorkflowContext.bucket is required to retrieve R2 data')
		}
		return await retrieveFromR2<T>(ctx.bucket, result.r2Key)
	}

	return null
}

/**
 * Generate cleanup prefix for intermediate data
 * Pure function
 *
 * @param prefix - Custom prefix for the R2 path
 * @param workflowInstanceId - Unique workflow instance ID
 * @returns Prefix for listing objects to delete
 */
export function generateCleanupPrefix(prefix: string, workflowInstanceId: string): string {
	const base = prefix ? `${prefix}/` : ''
	return `${base}${workflowInstanceId}/`
}

/**
 * Clean up intermediate data from R2
 * Uses WorkflowContext for bucket and instanceId
 * Deletes all objects with the workflow's prefix
 *
 * @param ctx - WorkflowContext with bucket and workflowInstanceId
 * @param prefix - Custom prefix for the R2 path
 * @throws Error if ctx.bucket is undefined
 *
 * @example
 * ```typescript
 * // At end of workflow
 * await cleanupIntermediateData(ctx, 'my-workflow-data')
 * ```
 */
export async function cleanupIntermediateData(ctx: WorkflowContext, prefix: string): Promise<void> {
	if (!ctx.bucket) {
		throw new Error('WorkflowContext.bucket is required for cleanupIntermediateData')
	}

	const cleanupPrefix = generateCleanupPrefix(prefix, ctx.workflowInstanceId)
	const list = await ctx.bucket.list({ prefix: cleanupPrefix })

	if (list.objects.length > 0) {
		await Promise.all(list.objects.map((obj) => ctx.bucket!.delete(obj.key)))
	}
}
