/**
 * Check if a character report has been cancelled
 */

import { createDb } from '../../../db'
import { isReportCancelled } from '../../../db/queries'

/**
 * Check if report was cancelled by the user
 * This prevents unnecessary processing for cancelled reports
 *
 * @param databaseUrl - Database connection URL
 * @param reportId - Report UUID
 * @returns true if cancelled, false otherwise
 */
export async function checkCancellation(
	databaseUrl: string,
	reportId: string,
): Promise<boolean> {
	const db = createDb(databaseUrl)
	return await isReportCancelled(db, reportId)
}
