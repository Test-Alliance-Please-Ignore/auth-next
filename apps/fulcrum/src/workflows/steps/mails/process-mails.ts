import { retrieveData, storeOrReturn, type StepResult } from '../../utils/storage'
import { enrichMails } from '../../processors/helpers/mails'
import type { MailWithContent } from './fetch-mails'

export async function processMails(
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

		const mails = data as MailWithContent[]
		if (!Array.isArray(mails)) {
			return {
				source: 'none',
				success: false,
				error: 'Invalid mails structure',
			}
		}

		console.log('[processMails] Starting enrichment', {
			count: mails.length,
			sample: mails[0]
				? {
						mail_id: mails[0].mail_id,
						subject: mails[0].subject,
						from: mails[0].from,
						hasBody: !!mails[0].body,
					}
				: null,
		})

		const enrichedData = await enrichMails(env, mails, characterId)

		console.log('[processMails] Enrichment complete', {
			count: enrichedData.length,
			sample: enrichedData[0]
				? {
						mail_id: enrichedData[0].mail_id,
						subject: enrichedData[0].subject,
						fromName: enrichedData[0].fromName,
						hasBody: !!enrichedData[0].body,
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