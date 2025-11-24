/**
 * Generate HTML report from processed data and store in R2
 */

import { retrieveData, generateReportPath, type StepResult } from '../../utils/storage'
import { generateReport } from '../../../templates/report-generator'

/**
 * Collect non-null results into an array
 * Pure function for testability
 */
export function collectResults(data: unknown[]): unknown[] {
	return data.filter((d) => d !== null && d !== undefined)
}

/**
 * Generate HTML report from all processed data and store in R2
 * Retrieves data from all processing steps, generates HTML, and stores it
 *
 * @param bucket - R2 bucket to store report
 * @param getBucket - Function to get R2 bucket by name
 * @param processResult - Result from process-public-info step
 * @param characterId - EVE character ID
 * @param reportId - Report UUID
 * @param processAssetsResult - Result from process-assets step
 * @param processWalletTransactionsResult - Result from process-wallet-transactions step
 * @param processWalletJournalResult - Result from process-wallet-journal step
 * @param processMailsResult - Result from process-mails step
 * @param processContactsResult - Result from process-contacts step
 * @returns Object with bucket name and key
 */
export async function generateHtmlReport(
	bucket: R2Bucket,
	getBucket: (name: string) => R2Bucket,
	processResult: StepResult,
	characterId: string,
	reportId: string,
	processAssetsResult?: StepResult,
	processWalletTransactionsResult?: StepResult,
	processWalletJournalResult?: StepResult,
	processMailsResult?: StepResult,
	processContactsResult?: StepResult,
): Promise<{ bucket: string; key: string }> {
	// Retrieve processed data
	const publicInfoData = processResult.success
		? await retrieveData(getBucket, processResult)
		: null

	// Retrieve assets data if available
	const assetsData =
		processAssetsResult?.success && processAssetsResult
			? await retrieveData(getBucket, processAssetsResult)
			: null

	// Retrieve wallet transactions data if available
	const walletTransactionsData =
		processWalletTransactionsResult?.success && processWalletTransactionsResult
			? await retrieveData(getBucket, processWalletTransactionsResult)
			: null

	const walletJournalData =
		processWalletJournalResult?.success && processWalletJournalResult
			? await retrieveData(getBucket, processWalletJournalResult)
			: null

	const mailsData =
		processMailsResult?.success && processMailsResult
			? await retrieveData(getBucket, processMailsResult)
			: null

	const contactsData =
		processContactsResult?.success && processContactsResult
			? await retrieveData(getBucket, processContactsResult)
			: null

	// Collect all available data
	const results = collectResults(
		[publicInfoData, assetsData, walletTransactionsData, walletJournalData, mailsData, contactsData].filter(
			(d) => d !== null && d !== undefined,
		),
	)

	// Generate HTML from results (handles partial data gracefully)
	const html = generateReport(results)

	// Store HTML directly in R2 at final report path
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
