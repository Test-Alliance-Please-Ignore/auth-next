/**
 * Clean up intermediate data from R2
 * Removes temporary data stored during workflow processing
 */

import { cleanupIntermediateData as cleanupHelper } from '../../utils/storage'

/**
 * Delete all intermediate data for this workflow from R2
 *
 * @param bucket - R2 bucket containing intermediate data
 * @param workflowInstanceId - Workflow instance ID
 */
export async function cleanupIntermediateData(
	bucket: R2Bucket,
	workflowInstanceId: string,
): Promise<void> {
	await cleanupHelper(bucket, workflowInstanceId)
}
