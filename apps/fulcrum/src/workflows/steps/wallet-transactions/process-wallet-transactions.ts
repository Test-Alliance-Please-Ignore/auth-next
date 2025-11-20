/**
 * Process and enrich character wallet transactions
 * Resolves IDs to human-readable names using ESI Type Resolver
 */

import type { CharacterMarketTransaction } from '@repo/esi'
import { retrieveData, storeOrReturn, type StepResult } from '../../utils/storage'
import { enrichWalletTransactions } from '../../processors/helpers/wallet-transactions'

/**
 * Process wallet transactions by enriching with resolved names
 * Retrieves ESI data from previous step and enriches with name resolution
 *
 * @param env - Worker environment with bindings
 * @param getBucket - Function to get R2 bucket by name
 * @param bucket - R2 bucket for storage
 * @param bucketName - Name of R2 bucket
 * @param fetchResult - Result from fetch-wallet-transactions step
 * @param workflowInstanceId - Workflow instance ID
 * @param characterId - Character ID for authenticated structure lookups
 * @returns StepResult with enriched wallet transactions data
 */
export async function processWalletTransactions(
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
		// Check if fetch was successful
		if (!fetchResult.success) {
			return {
				source: 'none',
				success: false,
				error: 'Fetch failed: ' + (fetchResult as any).error,
			}
		}

		// Retrieve data from payload or R2 (already transformed by ESI worker)
		const data = await retrieveData(getBucket, fetchResult)
		if (!data) {
			return {
				source: 'none',
				success: false,
				error: 'No data retrieved from fetch step',
			}
		}

		// Validate data structure
		const transactions = data as CharacterMarketTransaction[]
		if (!Array.isArray(transactions)) {
			return {
				source: 'none',
				success: false,
				error: 'Invalid wallet transactions structure',
			}
		}

		// Enrich data by resolving IDs to names
		console.log('[processWalletTransactions] Starting enrichment', {
			transactionCount: transactions.length,
			sampleTransaction: transactions[0]
				? {
						typeId: transactions[0].type_id,
						clientId: transactions[0].client_id,
						locationId: transactions[0].location_id,
					}
				: null,
		})

		const enrichedData = await enrichWalletTransactions(env, transactions, characterId)

		console.log('[processWalletTransactions] Enrichment complete', {
			enrichedCount: enrichedData.length,
			sampleEnriched: enrichedData[0]
				? {
						typeId: enrichedData[0].type_id,
						typeName: enrichedData[0].typeName,
						clientId: enrichedData[0].client_id,
						clientName: enrichedData[0].clientName,
						locationId: enrichedData[0].location_id,
						locationName: enrichedData[0].locationName,
						totalValue: enrichedData[0].totalValue,
					}
				: null,
		})

		// Store or return based on size
		const result = await storeOrReturn(
			bucket,
			bucketName,
			workflowInstanceId,
			'process-wallet-transactions',
			enrichedData,
		)

		console.log('[processWalletTransactions] Storage result', {
			source: result.source,
			success: result.success,
		})

		return result
	} catch (error) {
		return {
			source: 'none',
			success: false,
			error: error instanceof Error ? error.message : String(error),
		}
	}
}

