/**
 * Storage utilities for R2 storage for workflow steps
 * All step outputs are stored in R2 to enable analyze steps to access previous outputs
 */

import { logger } from '@repo/hono-helpers'

import { safeJsonParse, safeJsonStringify } from './json'

/**
 * Result type that indicates where data is stored
 * Uses `any` for data to ensure Cloudflare Workflow serializability
 */
export type StepResult<T = any> =
	| { source: 'payload'; success: true; data: T }
	| { source: 'r2'; success: true; r2Bucket: string; r2Key: string }
	| { source: 'none'; success: false; error: string }

/**
 * Generate R2 key for intermediate data
 * Pure function - no side effects
 */
export function generateR2Key(
	workflowInstanceId: string,
	stepId: string,
): string {
	return `character-report-data/${workflowInstanceId}/${stepId}.json`
}

/**
 * Store data in R2
 * Injectable bucket dependency for testability
 */
export async function storeInR2(
	bucket: R2Bucket,
	key: string,
	data: unknown,
): Promise<void> {
	const json = safeJsonStringify(data)
	await bucket.put(key, json)
}

/**
 * Store data in R2
 * All step outputs are stored in R2 regardless of size to enable analyze steps
 * to access previous step outputs for finding connections between entities
 *
 * @param bucket - R2 bucket to store data in
 * @param bucketName - Name of the bucket for reference
 * @param workflowInstanceId - Workflow instance ID
 * @param stepId - Step identifier
 * @param data - Data to store
 * @returns StepResult with R2 location reference
 */
export async function storeOrReturn<T>(
	bucket: R2Bucket,
	bucketName: string,
	workflowInstanceId: string,
	stepId: string,
	data: T,
): Promise<StepResult<T>> {
	const r2Key = generateR2Key(workflowInstanceId, stepId)
	await storeInR2(bucket, r2Key, data)
	return { source: 'r2', success: true, r2Bucket: bucketName, r2Key }
}

/**
 * Retrieve data from R2
 * Injectable bucket dependency for testability
 */
export async function retrieveFromR2<T>(
	bucket: R2Bucket,
	key: string,
): Promise<T | null> {
	const obj = await bucket.get(key)
	if (!obj) {
		return null
	}
	const json = await obj.text()
	return safeJsonParse<T>(json)
}

/**
 * Retrieve data from StepResult
 * Handles both payload and R2 storage sources
 *
 * @param getBucket - Function to get bucket by name
 * @param result - StepResult from previous step
 * @returns Data or null if unsuccessful
 */
export async function retrieveData<T>(
	getBucket: (name: string) => R2Bucket,
	result: StepResult<T>,
): Promise<T | null> {
	if (!result.success) {
		return null
	}

	if (result.source === 'payload') {
		return result.data
	}

	if (result.source === 'r2') {
		try {
			const bucket = getBucket(result.r2Bucket)
			return await retrieveFromR2<T>(bucket, result.r2Key)
		} catch (error) {
			logger.error(`[retrieveData] Failed to retrieve from R2 key '${result.r2Key}':`, {
				error: error instanceof Error ? error.message : String(error),
				bucket: result.r2Bucket,
			})
			return null
		}
	}

	return null
}

/**
 * Generate cleanup prefix for intermediate data
 * Pure function
 */
export function generateCleanupPrefix(workflowInstanceId: string): string {
	return `character-report-data/${workflowInstanceId}/`
}

/**
 * Clean up intermediate data from R2
 *
 * @param bucket - R2 bucket to clean up
 * @param workflowInstanceId - Workflow instance ID
 */
export async function cleanupIntermediateData(
	bucket: R2Bucket,
	workflowInstanceId: string,
): Promise<void> {
	const prefix = generateCleanupPrefix(workflowInstanceId)
	const list = await bucket.list({ prefix })

	if (list.objects.length > 0) {
		await Promise.all(list.objects.map((obj) => bucket.delete(obj.key)))
	}
}

/**
 * Generate final report path
 * Pure function
 */
export function generateReportPath(
	characterId: string,
	reportId: string,
): string {
	return `character-reports/${characterId}/${reportId}`
}
