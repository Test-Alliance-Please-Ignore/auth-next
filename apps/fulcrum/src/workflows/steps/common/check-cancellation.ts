/**
 * Check if a character report has been cancelled
 */

import { getStub } from '@repo/do-utils'
import type { Fulcrum } from '@repo/fulcrum'

/**
 * Check if report was cancelled by the user
 * This prevents unnecessary processing for cancelled reports
 *
 * @param env - Environment with FULCRUM durable object namespace
 * @param reportId - Report UUID
 * @returns true if cancelled, false otherwise
 */
export async function checkCancellation(
	env: { FULCRUM: DurableObjectNamespace },
	reportId: string,
): Promise<boolean> {
	const stub = getStub<Fulcrum>(env.FULCRUM, 'default')
	return await stub.isReportCancelled(reportId)
}
