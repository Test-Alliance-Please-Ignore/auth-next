import { retrieveData, storeOrReturn, type StepResult } from '../../utils/storage'
import { enrichMails } from '../../processors/helpers/mails'
import type { CharacterAffiliationCoordinator } from '../../processors/helpers/character-affiliation'
import type { EntityLinkCoordinator } from '../../processors/helpers/entity-links'
import type { CoreBinding } from '../../../types/core-binding'
import type { MailFetchResult } from './fetch-mails'

export async function processMails(
	env: {
		ESI_TYPE_RESOLVER: DurableObjectNamespace
		ESI: DurableObjectNamespace
		EVE_TOKEN_STORE: DurableObjectNamespace
		CORE: CoreBinding
	},
	getBucket: (name: string) => R2Bucket,
	bucket: R2Bucket,
	bucketName: string,
	fetchResult: StepResult,
	workflowInstanceId: string,
	characterId: string,
	affiliationCoordinator?: CharacterAffiliationCoordinator,
	entityLinkCoordinator?: EntityLinkCoordinator,
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

		const fetchData = data as MailFetchResult
		const { mails, mailingLists, labels } = fetchData

		console.log('[processMails] Starting enrichment', {
			count: mails.length,
			mailingListCount: mailingLists.length,
			sample: mails[0]
				? {
					mail_id: mails[0].mail_id,
					subject: mails[0].subject,
					from: mails[0].from,
					hasBody: !!mails[0].body,
				}
				: null,
		})

		const enrichedData = await enrichMails(
			env,
			mails,
			characterId,
			mailingLists,
			labels,
			affiliationCoordinator,
			entityLinkCoordinator,
		)

		console.log('[processMails] Enrichment complete', {
			count: enrichedData.mails.length,
			sample: enrichedData.mails[0]
				? {
					mail_id: enrichedData.mails[0].mail_id,
					subject: enrichedData.mails[0].subject,
					fromName: enrichedData.mails[0].fromName,
					hasBody: !!enrichedData.mails[0].body,
				}
				: null,
		})

		// Store in R2
		return await storeOrReturn(
			bucket,
			bucketName,
			workflowInstanceId,
			'process-mails',
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
