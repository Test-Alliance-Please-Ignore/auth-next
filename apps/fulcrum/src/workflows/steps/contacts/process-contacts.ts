/**
 * Process and enrich character contacts
 * Resolves IDs to human-readable names using ESI Type Resolver
 */

import type { CharacterContact } from '@repo/esi'
import { retrieveData, storeOrReturn, type StepResult } from '../../utils/storage'
import { enrichContacts } from '../../processors/helpers/contacts'

/**
 * Process character contacts by enriching with resolved names
 * Retrieves ESI data from previous step and enriches with name resolution
 *
 * @param env - Worker environment with bindings
 * @param getBucket - Function to get R2 bucket by name
 * @param bucket - R2 bucket for storage
 * @param bucketName - Name of R2 bucket
 * @param fetchResult - Result from fetch-contacts step
 * @param workflowInstanceId - Workflow instance ID
 * @param characterId - EVE character ID
 * @returns StepResult with enriched character contacts data
 */
export async function processContacts(
	env: {
		ESI_TYPE_RESOLVER: DurableObjectNamespace
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
		const contacts = data as CharacterContact[]
		if (!Array.isArray(contacts)) {
			return {
				source: 'none',
				success: false,
				error: 'Invalid character contacts structure',
			}
		}

		console.log('[processContacts] Starting enrichment', {
			totalContacts: contacts.length,
			sampleContact: contacts[0]
				? {
						contactId: contacts[0].contact_id,
						contactType: contacts[0].contact_type,
						standing: contacts[0].standing,
					}
				: null,
		})

		// Enrich data by resolving IDs to names
		const enrichedData = await enrichContacts(env, contacts, characterId)

		console.log('[processContacts] Enrichment complete', {
			enrichedCount: enrichedData.length,
			sampleEnriched: enrichedData[0]
				? {
						contactId: enrichedData[0].contact_id,
						contactName: enrichedData[0].contactName,
						standing: enrichedData[0].standing,
						standingDisplay: enrichedData[0].standingDisplay,
					}
				: null,
		})

		// Store in R2
		const result = await storeOrReturn(
			bucket,
			bucketName,
			workflowInstanceId,
			'process-contacts',
			enrichedData,
		)

		console.log('[processContacts] Storage result', {
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
