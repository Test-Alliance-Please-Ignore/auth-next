/**
 * Update database with final report status and R2 location
 */

import { createDb } from '../../../db'
import { characterReports } from '../../../db/schema'
import { buildUpdateReportStatusQuery } from '../../../db/queries'

/**
 * Update database to mark report as completed and store R2 location
 *
 * @param databaseUrl - Database connection URL
 * @param reportId - Report UUID
 * @param bucket - R2 bucket name
 * @param key - R2 key where report is stored
 */
export async function updateDatabase(
	databaseUrl: string,
	reportId: string,
	bucket: string,
	key: string,
): Promise<void> {
	const db = createDb(databaseUrl)

	const query = buildUpdateReportStatusQuery(reportId, 'completed', {
		r2Bucket: bucket,
		r2Key: key,
	})

	await db.update(characterReports).set(query.set).where(query.where)
}
