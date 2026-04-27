/**
 * Update database with final report status and R2 location
 */

import { logger } from '@repo/hono-helpers'

import { createDb } from '../../../db'
import { characterReports } from '../../../db/schema'
import { buildUpdateReportStatusQuery, getReport } from '../../../db/queries'
import { sendReportCompletedDM } from '../../../lib/discord-webhook'
import { resolveReportMetadata } from '../../../lib/report-metadata'

import type { Env } from '../../../context'

/**
 * Update database to mark report as completed and store R2 location
 *
 * @param env - Environment bindings
 * @param databaseUrl - Database connection URL
 * @param reportId - Report UUID
 * @param bucket - R2 bucket name
 * @param key - R2 key where report is stored
 */
export async function updateDatabase(
	env: Env,
	databaseUrl: string,
	reportId: string,
	bucket: string,
	key: string,
	sendDm = true,
): Promise<void> {
	const db = createDb(databaseUrl)

	const query = buildUpdateReportStatusQuery(reportId, 'completed', {
		r2Bucket: bucket,
		r2Key: key,
	})

	await db.update(characterReports).set(query.set).where(query.where)

	// Send Discord DM notification (non-blocking)
	if (sendDm) {
		try {
			// Fetch report to get metadata
			const report = await getReport(db, reportId)

			if (report) {
				const metadata = await resolveReportMetadata(
					env,
					reportId,
					report.requestorUserId,
					report.characterId,
					report.characterName,
					report.requestorCorporationId
				)

				if (metadata) {
					// Construct report view URL
					const viewUrl = `${env.APP_BASE_URL}/fulcrum/reports/${reportId}`

					await sendReportCompletedDM(env, report.requestorUserId, metadata, viewUrl)
				}
			}
		} catch (error) {
			// Log but don't fail - DM failures should not block workflow
			logger.error('[Workflow] Failed to send report completed DM', {
				reportId,
				error: error instanceof Error ? error.message : String(error),
			})
		}
	}
}
