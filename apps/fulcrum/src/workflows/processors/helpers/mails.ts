import { getStub } from '@repo/do-utils'
import { normalizeIdToString } from '@repo/esi'
import { stripHtmlToPlainText } from './html-stripper'

import type { EsiTypeResolver } from '@repo/esi'
import type { MailWithContent } from '../../steps/mails/fetch-mails'

export interface ProcessedMail extends MailWithContent {
	fromName?: string
	recipients?: Array<{
		recipient_id: string
		recipient_type: 'alliance' | 'character' | 'corporation' | 'mailing_list'
		recipientName?: string
	}>
	bodyPlainText?: string
	timestampFormatted?: string
	processedAt: string
}

export type ProcessedMails = ProcessedMail[]

/**
 * Format timestamp to a more readable format
 */
function formatTimestamp(timestamp?: string): string | undefined {
	if (!timestamp) return undefined

	const date = new Date(timestamp)
	if (isNaN(date.getTime())) return timestamp

	return date.toLocaleString('en-US', {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		hour12: false,
	})
}


export async function enrichMails(
	env: {
		ESI_TYPE_RESOLVER: DurableObjectNamespace
		ESI: DurableObjectNamespace
	},
	mails: MailWithContent[],
	characterId: string
): Promise<ProcessedMails> {
	if (mails.length === 0) {
		return []
	}

	// Collect all IDs that need to be resolved
	const idsToResolve = new Set<string>()

	for (const mail of mails) {
		// Add sender ID
		const fromId = normalizeIdToString(mail.from)
		if (fromId) {
			idsToResolve.add(fromId)
		}

		// Add recipient IDs
		if (mail.recipients) {
			for (const recipient of mail.recipients) {
				const recipientId = normalizeIdToString(recipient.recipient_id)
				if (recipientId) {
					idsToResolve.add(recipientId)
				}
			}
		}
	}

	// Resolve all IDs to names
	let nameMap: Record<string, string> = {}
	if (idsToResolve.size > 0) {
		try {
			const typeResolver = getStub<EsiTypeResolver>(env.ESI_TYPE_RESOLVER, 'global')
			nameMap = await typeResolver.resolveIds(Array.from(idsToResolve))
		} catch (error) {
			console.error('Failed to resolve IDs for mails:', error)
		}
	}

	// Process each mail with resolved names
	const processedMails: ProcessedMail[] = mails.map((mail) => {
		const fromId = normalizeIdToString(mail.from)
		const fromName = fromId ? nameMap[fromId] : undefined

		// Process recipients with resolved names
		const processedRecipients = mail.recipients?.map(recipient => {
			const recipientId = normalizeIdToString(recipient.recipient_id)
			return {
				...recipient,
				recipientName: recipientId ? nameMap[recipientId] : undefined
			}
		})

		return {
			...mail,
			fromName,
			recipients: processedRecipients,
			bodyPlainText: stripHtmlToPlainText(mail.body),
			timestampFormatted: formatTimestamp(mail.timestamp),
			processedAt: new Date().toISOString(),
		}
	})

	// Sort by timestamp, newest first
	processedMails.sort((a, b) => {
		const timeA = a.timestamp ? new Date(a.timestamp).getTime() : 0
		const timeB = b.timestamp ? new Date(b.timestamp).getTime() : 0
		return timeB - timeA
	})

	return processedMails
}