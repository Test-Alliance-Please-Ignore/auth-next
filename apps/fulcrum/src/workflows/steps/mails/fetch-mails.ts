import { getEsiInstanceForCharacter } from '@repo/esi'

import { storeOrReturn } from '../../utils/storage'
import { retryWithBackoff } from '../../utils/retry'

import type { Esi, CharacterMail, MailContent } from '@repo/esi'
import type { StepResult } from '../../utils/storage'

export interface MailWithContent extends CharacterMail {
	body?: string
}

/**
 * Fetch mail list and content from ESI stub
 * Separated for testability
 */
export async function fetchMailsFromEsi(esiStub: Esi, characterId: string): Promise<MailWithContent[]> {
	// First fetch the mail list
	const mailList = await esiStub.fetchCharacterMail(characterId)

	// Limit to most recent 50 mails to avoid excessive API calls
	const limitedMails = mailList.slice(0, 50)

	// Fetch content for each mail with rate limiting
	const mailsWithContent: MailWithContent[] = []

	for (const mail of limitedMails) {
		if (!mail.mail_id) {
			mailsWithContent.push(mail)
			continue
		}

		try {
			// Fetch mail content with retry and rate limit handling
			const content = await retryWithBackoff(
				async () => await esiStub.fetchMailContent(characterId, mail.mail_id!),
				{
					maxRetries: 3,
					initialDelayMs: 200,
					maxDelayMs: 5000,
				}
			)

			// Merge mail header with content
			mailsWithContent.push({
				...mail,
				body: content.body,
			})

			// Add delay between requests to avoid rate limiting
			await new Promise(resolve => setTimeout(resolve, 200))
		} catch (error) {
			// If we can't fetch content for a mail, include it without body
			console.error(`Failed to fetch content for mail ${mail.mail_id}:`, error)
			mailsWithContent.push(mail)
		}
	}

	return mailsWithContent
}

/**
 * Fetch character mails with content from ESI and store in R2
 *
 * @param esiBinding - ESI Durable Object namespace
 * @param bucket - R2 bucket for storage
 * @param bucketName - Name of R2 bucket
 * @param characterId - EVE character ID
 * @param workflowInstanceId - Workflow instance ID for R2 key generation
 * @returns StepResult with R2 location reference
 */
export async function fetchMails(
	esiBinding: DurableObjectNamespace,
	bucket: R2Bucket,
	bucketName: string,
	characterId: string,
	workflowInstanceId: string
): Promise<StepResult> {
	try {
		const stub = getEsiInstanceForCharacter(esiBinding, characterId)
		const data = await fetchMailsFromEsi(stub, characterId)
		// Store in R2
		return await storeOrReturn(bucket, bucketName, workflowInstanceId, 'fetch-mails', data)
	} catch (error) {
		return {
			source: 'none',
			success: false,
			error: error instanceof Error ? error.message : String(error),
		}
	}
}