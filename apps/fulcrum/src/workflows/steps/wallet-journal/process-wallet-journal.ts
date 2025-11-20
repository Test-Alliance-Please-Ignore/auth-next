import type { CharacterWalletJournalEntry } from '@repo/esi'
import { retrieveData, storeOrReturn, type StepResult } from '../../utils/storage'
import { enrichWalletJournalEntries } from '../../processors/helpers/wallet-journal'

export async function processWalletJournal(
	env: {
		ESI_TYPE_RESOLVER: DurableObjectNamespace
		ESI: DurableObjectNamespace
	},
	getBucket: (name: string) => R2Bucket,
	bucket: R2Bucket,
	bucketName: string,
	fetchResult: StepResult,
	workflowInstanceId: string,
	characterId: string,
): Promise<StepResult> {
	try {
		if (!fetchResult.success) {
			return {
				source: 'none',
				success: false,
				error: 'Fetch failed: ' + (fetchResult as any).error,
			}
		}

		const data = await retrieveData(getBucket, fetchResult)
		if (!data) {
			return {
				source: 'none',
				success: false,
				error: 'No data retrieved from fetch step',
			}
		}

		const entries = data as CharacterWalletJournalEntry[]
		if (!Array.isArray(entries)) {
			return {
				source: 'none',
				success: false,
				error: 'Invalid character wallet journal structure',
			}
		}

		console.log('[processWalletJournal] Starting enrichment', {
			count: entries.length,
			sample: entries[0]
				? {
						id: entries[0].id,
						refType: entries[0].ref_type,
						amount: entries[0].amount,
					}
				: null,
		})

		const enrichedData = await enrichWalletJournalEntries(env, entries, characterId)

		console.log('[processWalletJournal] Enrichment complete', {
			count: enrichedData.length,
			sample: enrichedData[0]
				? {
						id: enrichedData[0].id,
						refType: enrichedData[0].ref_type,
						refTypeLabel: enrichedData[0].refTypeLabel,
						amountFormatted: enrichedData[0].amountFormatted,
					}
				: null,
		})

		// Store in R2
		return await storeOrReturn(
			bucket,
			bucketName,
			workflowInstanceId,
			'process-wallet-journal',
			enrichedData,
		)
	} catch (error) {
		return {
			source: 'none',
			success: false,
			error: error instanceof Error ? error.message : String(error),
		}
	}
}

