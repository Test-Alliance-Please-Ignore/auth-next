import { getStub } from '@repo/do-utils'
import { normalizeIdToString } from '@repo/eve-types'
import { stripHtmlToPlainText } from './html-stripper'
import type { CharacterAffiliationCoordinator } from './character-affiliation'
import type { EntityLinkCoordinator } from './entity-links'

import type { EsiTypeResolver, MailingList, MailLabelsResponse } from '@repo/esi'
import type { MailWithContent } from '../../steps/mails/fetch-mails'
import type { CoreBinding } from '../../../types/core-binding'

export interface ProcessedMail extends MailWithContent {
	fromName?: string
	fromDisplayName?: string
	fromDisplayHref?: string
	recipients?: Array<{
		recipient_id: string
		recipient_type: 'alliance' | 'character' | 'corporation' | 'mailing_list'
		recipientName?: string
		recipientDisplayName?: string
		recipientDisplayHref?: string
	}>
	bodyPlainText?: string
	timestampFormatted?: string
	processedAt: string
}

export interface EnrichedMailData {
	mails: ProcessedMail[]
	mailingLists: MailingList[]
	labels: MailLabelsResponse
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
		EVE_TOKEN_STORE: DurableObjectNamespace
		CORE: CoreBinding
	},
	mails: MailWithContent[],
	characterId: string,
	mailingLists: MailingList[] = [],
	labels: MailLabelsResponse = { labels: [], total_unread_count: 0 },
	affiliationCoordinator?: CharacterAffiliationCoordinator,
	entityLinkCoordinator?: EntityLinkCoordinator,
): Promise<EnrichedMailData> {
	if (mails.length === 0) {
		return { mails: [], mailingLists, labels }
	}

	// Build a mailing list name lookup
	const mailingListNames = new Map<string, string>()
	for (const ml of mailingLists) {
		mailingListNames.set(String(ml.mailing_list_id), ml.name)
	}

	// Collect all IDs that need to be resolved (skip mailing list IDs - we have their names already)
	const idsToResolve = new Set<string>()

	for (const mail of mails) {
		// Add sender ID
		const fromId = normalizeIdToString(mail.from)
		if (fromId) {
			idsToResolve.add(fromId)
		}

		// Add recipient IDs (skip mailing_list type - resolved from mailingLists data)
		if (mail.recipients) {
			for (const recipient of mail.recipients) {
				if (recipient.recipient_type === 'mailing_list') continue
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

	const characterDisplayNameMap =
		affiliationCoordinator && idsToResolve.size > 0
			? await affiliationCoordinator.resolveDisplayNames(
					{ ESI: env.ESI },
					characterId,
					mails.flatMap((mail) => {
						const candidates: Array<{
							characterId: string
							characterName?: string
							forceCharacter?: boolean
						}> = []
						const fromId = normalizeIdToString(mail.from)
						if (fromId && nameMap[fromId]) {
							candidates.push({
								characterId: fromId,
								characterName: nameMap[fromId],
								forceCharacter: true,
							})
						}
						for (const recipient of mail.recipients ?? []) {
							if (recipient.recipient_type !== 'character') continue
							const recipientId = normalizeIdToString(recipient.recipient_id)
							if (recipientId && nameMap[recipientId]) {
								candidates.push({
									characterId: recipientId,
									characterName: nameMap[recipientId],
									forceCharacter: true,
								})
							}
						}
						return candidates
					}),
					'enrichMails',
				)
			: {}

	const displayHrefMap =
		entityLinkCoordinator && idsToResolve.size > 0
			? await entityLinkCoordinator.resolveDisplayHrefs(
					env.CORE,
					mails.flatMap((mail) => {
						const candidates: Array<{ entityId: string; entityType?: string | null }> = []
						const fromId = normalizeIdToString(mail.from)
						if (fromId) {
							candidates.push({ entityId: fromId })
						}
						for (const recipient of mail.recipients ?? []) {
							if (recipient.recipient_type === 'mailing_list') continue
							const recipientId = normalizeIdToString(recipient.recipient_id)
							if (recipientId) {
								candidates.push({ entityId: recipientId, entityType: recipient.recipient_type })
							}
						}
						return candidates
					}),
					'enrichMails',
				)
			: {}

	// Process each mail with resolved names
	const processedMails: ProcessedMail[] = mails.map((mail) => {
		const fromId = normalizeIdToString(mail.from)
		const fromName = fromId ? nameMap[fromId] : undefined
		const fromDisplayName = fromId ? characterDisplayNameMap[fromId] ?? fromName : undefined
		const fromDisplayHref = fromId ? displayHrefMap[fromId] : undefined

		// Process recipients with resolved names
		const processedRecipients = mail.recipients?.map(recipient => {
			const recipientId = normalizeIdToString(recipient.recipient_id)
			let recipientName: string | undefined
			let recipientDisplayName: string | undefined
			let recipientDisplayHref: string | undefined
			if (recipient.recipient_type === 'mailing_list' && recipientId) {
				recipientName = mailingListNames.get(recipientId)
			} else if (recipientId) {
				recipientName = nameMap[recipientId]
				if (recipient.recipient_type === 'character') {
					recipientDisplayName = characterDisplayNameMap[recipientId] ?? recipientName
				}
				recipientDisplayHref = displayHrefMap[recipientId]
			}
			return {
				...recipient,
				recipientName,
				recipientDisplayName,
				recipientDisplayHref,
			}
		})

		return {
			...mail,
			fromName,
			fromDisplayName,
			fromDisplayHref,
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

	return { mails: processedMails, mailingLists, labels }
}
