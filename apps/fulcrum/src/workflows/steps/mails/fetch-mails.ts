import { getEsiInstanceForCharacter } from '@repo/esi'

import { storeOrReturn } from '../../utils/storage'
import { retryWithBackoff } from '../../utils/retry'

import type { Esi, CharacterMail, MailContent, MailingList, MailLabelsResponse } from '@repo/esi'
import type { StepResult } from '../../utils/storage'

export interface MailWithContent extends CharacterMail {
	body?: string
}

export interface MailFetchResult {
	mails: MailWithContent[]
	mailingLists: MailingList[]
	labels: MailLabelsResponse
}

/**
 * Fetch ALL mails using cursor-based pagination via last_mail_id.
 * ESI returns 50 mails per page; we loop until we get an empty page.
 */
async function fetchAllMailHeaders(esiStub: Esi, characterId: string): Promise<CharacterMail[]> {
	const allMails: CharacterMail[] = []
	let lastMailId: string | undefined

	for (let page = 0; page < 20; page++) { // Safety cap at 1000 mails (20 pages × 50)
		const batch = await retryWithBackoff(
			async () => await esiStub.fetchCharacterMailPage(characterId, lastMailId),
			{ maxRetries: 3, initialDelayMs: 1000, maxDelayMs: 30000 }
		)

		if (!batch || batch.length === 0) break

		allMails.push(...batch)

		// Find lowest mail_id for cursor
		const lowestId = batch.reduce<string | undefined>((min, mail) => {
			if (!mail.mail_id) return min
			if (!min) return mail.mail_id
			return BigInt(mail.mail_id) < BigInt(min) ? mail.mail_id : min
		}, undefined)

		if (!lowestId || batch.length < 50) break

		lastMailId = lowestId

		// Rate limit between pages
		await new Promise(resolve => setTimeout(resolve, 300))
	}

	return allMails
}

/**
 * Fetch all mail headers, content for each, mailing lists, and labels from ESI
 */
export async function fetchMailsFromEsi(esiStub: Esi, characterId: string): Promise<MailFetchResult> {
	// Fetch all mail headers, mailing lists, and labels in parallel where possible
	const [allMails, mailingLists, labels] = await Promise.all([
		fetchAllMailHeaders(esiStub, characterId),
		retryWithBackoff(
			async () => await esiStub.fetchMailingLists(characterId),
			{ maxRetries: 3, initialDelayMs: 1000, maxDelayMs: 30000 }
		).catch(() => [] as MailingList[]),
		retryWithBackoff(
			async () => await esiStub.fetchMailLabels(characterId),
			{ maxRetries: 3, initialDelayMs: 1000, maxDelayMs: 30000 }
		).catch(() => ({ labels: [], total_unread_count: 0 }) as MailLabelsResponse),
	])

	console.log(`[fetchMails] Fetched ${allMails.length} mail headers`)

	// Only fetch content for the most recent 100 mails during initial report generation.
	// Older mail content can be loaded on-demand by the reviewer via the UI.
	// This keeps us well within the ESI char-social rate limit (600 tokens / 15min, 2 tokens per 2xx).
	const maxContentFetches = 100
	const mailsToFetchContent = allMails.slice(0, maxContentFetches)
	const mailsSkipped = allMails.slice(maxContentFetches)

	if (mailsSkipped.length > 0) {
		console.log(`[fetchMails] Capping content fetches to ${maxContentFetches} (skipping ${mailsSkipped.length} oldest mails) due to ESI rate limits`)
	}

	// Fetch content in parallel batches
	const batchSize = 20
	const mailsWithContent: MailWithContent[] = []

	for (let i = 0; i < mailsToFetchContent.length; i += batchSize) {
		const batch = mailsToFetchContent.slice(i, i + batchSize)
		console.log(`[fetchMails] Fetching content batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(mailsToFetchContent.length / batchSize)}`)
		const results = await Promise.allSettled(
			batch.map(async (mail) => {
				if (!mail.mail_id) return mail as MailWithContent
				try {
					const content = await retryWithBackoff(
						async () => await esiStub.fetchMailContent(characterId, mail.mail_id!),
						{ maxRetries: 3, initialDelayMs: 1000, maxDelayMs: 30000 },
					)
					return { ...mail, body: content.body } as MailWithContent
				} catch (error) {
					console.error(`Failed to fetch content for mail ${mail.mail_id}:`, error)
					return mail as MailWithContent
				}
			}),
		)
		for (const result of results) {
			mailsWithContent.push(
				result.status === 'fulfilled' ? result.value : batch[0] as MailWithContent,
			)
		}
		// Brief pause between batches to be polite to ESI
		if (i + batchSize < mailsToFetchContent.length) {
			await new Promise((resolve) => setTimeout(resolve, 300))
		}
	}

	// Append skipped mails (no content fetched) to preserve full header list
	for (const mail of mailsSkipped) {
		mailsWithContent.push(mail as MailWithContent)
	}

	console.log(`[fetchMails] Done: ${mailsWithContent.length} mails total (${mailsWithContent.filter(m => m.body).length} with body, ${mailsSkipped.length} skipped)`)
	return { mails: mailsWithContent, mailingLists, labels }
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
		stub.setDefaultCacheMode('no-store')
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