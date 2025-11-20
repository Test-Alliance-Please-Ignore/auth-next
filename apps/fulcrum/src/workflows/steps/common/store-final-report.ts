/**
 * Store final HTML report in R2
 */

import { generateReportPath } from '../../utils/storage'

/**
 * Store final HTML report in R2 bucket
 *
 * @param bucket - R2 bucket to store report
 * @param characterId - EVE character ID
 * @param reportId - Report UUID
 * @param html - HTML content to store
 * @returns Object with bucket name and key
 */
export async function storeFinalReport(
	bucket: R2Bucket,
	characterId: string,
	reportId: string,
	html: string,
): Promise<{ bucket: string; key: string }> {
	const reportKey = generateReportPath(characterId, reportId)

	await bucket.put(reportKey, html, {
		httpMetadata: {
			contentType: 'text/html',
		},
	})

	return {
		bucket: 'CHARACTER_REPORTS',
		key: reportKey,
	}
}
