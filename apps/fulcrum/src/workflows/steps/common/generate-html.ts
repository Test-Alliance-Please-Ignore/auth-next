import { generateReport } from '../../../templates/report-generator'
import { generateReportPath, retrieveData } from '../../utils/storage'

import type { StepResult } from '../../utils/storage'

/**
 * Generate HTML report from processed data and store in R2
 */

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
 * @param processFittedShipsResult - Result from process-fitted-ships step
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
	processFittedShipsResult?: StepResult,
	processWalletTransactionsResult?: StepResult,
	processWalletJournalResult?: StepResult,
	processMailsResult?: StepResult,
	processContactsResult?: StepResult
): Promise<{ bucket: string; key: string }> {
	// Retrieve processed data
	const publicInfoData = processResult.success ? await retrieveData(getBucket, processResult) : null

	// Retrieve assets data if available
	const assetsData =
		processAssetsResult?.success && processAssetsResult
			? await retrieveData(getBucket, processAssetsResult)
			: null

	// Retrieve fitted ships data if available
	console.log('[generateHtmlReport] Fitted ships step result:', {
		hasResult: !!processFittedShipsResult,
		success: processFittedShipsResult?.success,
		source: processFittedShipsResult?.source,
		error: (processFittedShipsResult as any)?.error,
	})
	const fittedShipsData =
		processFittedShipsResult?.success && processFittedShipsResult
			? await retrieveData(getBucket, processFittedShipsResult)
			: null
	console.log('[generateHtmlReport] Retrieved fitted ships data:', {
		isNull: fittedShipsData === null,
		isArray: Array.isArray(fittedShipsData),
		length: Array.isArray(fittedShipsData) ? fittedShipsData.length : 'N/A',
		sample:
			Array.isArray(fittedShipsData) && fittedShipsData.length > 0
				? {
						shipName: fittedShipsData[0].shipName,
						shipTypeId: fittedShipsData[0].shipTypeId,
						hasRigs: Array.isArray(fittedShipsData[0].rigs),
					}
				: null,
	})

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
	const allData = [
		publicInfoData,
		assetsData,
		fittedShipsData,
		walletTransactionsData,
		walletJournalData,
		mailsData,
		contactsData,
	]
	console.log('[generateHtmlReport] All data before filtering:', {
		publicInfo: !!publicInfoData,
		assets: !!assetsData,
		fittedShips: !!fittedShipsData,
		walletTransactions: !!walletTransactionsData,
		walletJournal: !!walletJournalData,
		mails: !!mailsData,
		contacts: !!contactsData,
		fittedShipsType: fittedShipsData ? typeof fittedShipsData : 'null',
		fittedShipsIsArray: Array.isArray(fittedShipsData),
		fittedShipsLength: Array.isArray(fittedShipsData) ? fittedShipsData.length : 'N/A',
	})
	const results = collectResults(allData.filter((d) => d !== null && d !== undefined))
	console.log('[generateHtmlReport] Results array after collection:', {
		totalResults: results.length,
		resultTypes: results.map((r, index) => {
			if (!r) return 'null'
			if (Array.isArray(r)) {
				if (r.length === 0) return 'empty-array'
				const first = r[0]
				if (typeof first === 'object' && first !== null) {
					// Check fitted ships first (most specific - has shipName, shipTypeId AND rigs/highs/meds/lows arrays)
					if (
						'shipName' in first &&
						'shipTypeId' in first &&
						'locationId' in first &&
						'locationFlag' in first &&
						'locationType' in first &&
						Array.isArray(first.rigs) &&
						Array.isArray(first.highs) &&
						Array.isArray(first.meds) &&
						Array.isArray(first.lows)
					) {
						console.log(`[generateHtmlReport] Result ${index} identified as fitted-ships-array`, {
							shipName: first.shipName || 'undefined',
							shipTypeId: first.shipTypeId,
							hasRigs: Array.isArray(first.rigs),
							allKeys: Object.keys(first),
						})
						return 'fitted-ships-array'
					}
					// Then check other types
					if ('type_id' in first && 'item_id' in first) return 'assets-array'
					if ('transaction_id' in first) return 'wallet-transactions-array'
					if ('ref_type' in first) return 'wallet-journal-array'
					if ('mail_id' in first) return 'mails-array'
					if ('contact_id' in first) return 'contacts-array'

					// Log unknown array structure for debugging
					console.log(`[generateHtmlReport] Result ${index} is unknown-array, first element:`, {
						type: typeof first,
						keys: Object.keys(first),
						hasShipName: 'shipName' in first,
						hasTypeId: 'type_id' in first,
						hasItemId: 'item_id' in first,
						hasTransactionId: 'transaction_id' in first,
						hasRefType: 'ref_type' in first,
						hasMailId: 'mail_id' in first,
						hasContactId: 'contact_id' in first,
						sample: JSON.stringify(first).substring(0, 200),
					})
				}
				return 'unknown-array'
			}
			if (typeof r === 'object' && 'characterName' in r) return 'public-info'
			return 'unknown'
		}),
	})

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
