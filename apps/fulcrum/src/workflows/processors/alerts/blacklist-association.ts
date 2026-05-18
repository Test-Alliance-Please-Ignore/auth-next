/**
 * Blacklist Association Alert
 *
 * Cross-references every character ID found in the report data against
 * the set of all blacklisted character IDs. Any match produces a critical
 * alert detailing where the association was found.
 *
 * Data sources scanned:
 * - Wallet journal (first_party_id, second_party_id)
 * - Wallet transactions (client_id)
 * - Contracts (issuer_id, acceptor_id, assignee_id)
 * - Contacts (contact_id, character type only)
 * - Mails (from, recipients with type=character)
 * - Ship names (resolved character names from custom names)
 *
 * Severity: always critical
 */

import type { ProcessedWalletJournalEntry } from '../helpers/wallet-journal'
import type { ProcessedWalletTransaction } from '../helpers/wallet-transactions'
import type { ProcessedContract } from '../helpers/contracts'
import type { ProcessedContact } from '../helpers/contacts'
import type { ProcessedMail } from '../helpers/mails'
import type { ReportAlert } from './types'

const JITA_MARKET_BLACKLIST_MIN_ISK = 100_000_000
const JITA_4_4_STATION_ID = '60003760'

/** Where a blacklisted character was found */
export interface BlacklistMatch {
	/** The blacklisted character ID */
	characterId: string
	/** Resolved name (if available) */
	characterName?: string
	/** Which data source the match was found in */
	source: 'wallet-journal' | 'wallet-transactions' | 'contracts' | 'contacts' | 'mails' | 'ship-names'
	/** Human-readable detail about the specific record */
	detail: string
}

/** Grouped matches: one blacklisted character with all their touchpoints */
export interface BlacklistAssociationGroup {
	characterId: string
	characterName?: string
	matches: Array<{ source: BlacklistMatch['source']; detail: string }>
}

/**
 * Check all report data for references to blacklisted character IDs.
 *
 * @param blacklistedIds - Set of all blacklisted character IDs
 * @param blacklistedNames - Set of blacklisted character names (lowercased), used only as fallback
 * @param walletJournal - Processed wallet journal entries
 * @param walletTransactions - Processed wallet transactions
 * @param contracts - Processed contracts
 * @param contacts - Processed contacts
 * @param mails - Processed mails
 * @param shipNameCharacterIds - Character IDs resolved from custom ship names: charId → { customName, characterName }
 * @param reportCharacterId - The character being reported (excluded from matches)
 */
export function checkBlacklistAssociation(
	blacklistedIds: Set<string>,
	blacklistedNames: Set<string>,
	walletJournal: ProcessedWalletJournalEntry[] | null,
	walletTransactions: ProcessedWalletTransaction[] | null,
	contracts: ProcessedContract[] | null,
	contacts: ProcessedContact[] | null,
	mails: ProcessedMail[] | null,
	shipNameCharacterIds: Map<string, { customName: string; characterName: string }> | null,
	reportCharacterId: string,
): ReportAlert | null {
	if (blacklistedIds.size === 0 && blacklistedNames.size === 0) return null

	const matches: BlacklistMatch[] = []
	const parseIskNumber = (value: string | number | undefined): number => {
		if (typeof value === 'number') return Number.isFinite(value) ? value : 0
		if (!value) return 0
		const parsed = Number.parseFloat(String(value).replace(/,/g, ''))
		return Number.isFinite(parsed) ? parsed : 0
	}

	/** Format an ISO/ESI timestamp to a short human-readable string */
	const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
	const fmtDate = (raw: string | undefined | null): string => {
		if (!raw) return 'unknown date'
		const d = new Date(raw)
		if (Number.isNaN(d.getTime())) return raw
		const hh = String(d.getUTCHours()).padStart(2, '0')
		const mm = String(d.getUTCMinutes()).padStart(2, '0')
		return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()} ${hh}:${mm}`
	}

	// Helper: check if an ID is blacklisted (and not the report subject)
	const isBlacklisted = (id: string | undefined | null): id is string => {
		if (!id) return false
		if (id === reportCharacterId) return false
		return blacklistedIds.has(id)
	}

	// Fallback: only use character-name matching when ID did not match.
	const isBlacklistedByName = (
		idMatched: boolean,
		name: string | undefined | null,
		reportCharacterName?: string | null,
	): boolean => {
		if (idMatched) return false
		if (!name) return false
		const normalized = name.trim().toLowerCase()
		if (!normalized) return false
		if (reportCharacterName && normalized === reportCharacterName.trim().toLowerCase()) return false
		return blacklistedNames.has(normalized)
	}

	// Scan wallet journal
	if (walletJournal) {
		for (const entry of walletJournal) {
			if (isBlacklisted(entry.first_party_id)) {
				matches.push({
					characterId: entry.first_party_id,
					characterName: entry.firstPartyName,
					source: 'wallet-journal',
					detail: `${entry.refTypeLabel} on ${fmtDate(entry.date)} for ${entry.amountFormatted}`,
				})
			} else if (isBlacklistedByName(false, entry.firstPartyName)) {
				matches.push({
					characterId: entry.first_party_id ?? `name:${entry.firstPartyName}`,
					characterName: entry.firstPartyName,
					source: 'wallet-journal',
					detail: `${entry.refTypeLabel} on ${fmtDate(entry.date)} for ${entry.amountFormatted}`,
				})
			}
			if (isBlacklisted(entry.second_party_id)) {
				matches.push({
					characterId: entry.second_party_id,
					characterName: entry.secondPartyName,
					source: 'wallet-journal',
					detail: `${entry.refTypeLabel} on ${fmtDate(entry.date)} for ${entry.amountFormatted}`,
				})
			} else if (isBlacklistedByName(false, entry.secondPartyName)) {
				matches.push({
					characterId: entry.second_party_id ?? `name:${entry.secondPartyName}`,
					characterName: entry.secondPartyName,
					source: 'wallet-journal',
					detail: `${entry.refTypeLabel} on ${fmtDate(entry.date)} for ${entry.amountFormatted}`,
				})
			}
		}
	}

	// Scan wallet transactions
	if (walletTransactions) {
		for (const tx of walletTransactions) {
			const txValue = parseIskNumber(tx.totalValue)
			const shouldSuppressJitaNoise =
				tx.location_id === JITA_4_4_STATION_ID && txValue < JITA_MARKET_BLACKLIST_MIN_ISK
			if (shouldSuppressJitaNoise) continue

			if (isBlacklisted(tx.client_id)) {
				matches.push({
					characterId: tx.client_id,
					characterName: tx.clientName,
					source: 'wallet-transactions',
					detail: `${tx.is_buy ? 'Bought' : 'Sold'} ${tx.quantity}x ${tx.typeName ?? tx.type_id} on ${fmtDate(tx.date)} for ${tx.totalValue} ISK`,
				})
			} else if (isBlacklistedByName(false, tx.clientName)) {
				matches.push({
					characterId: tx.client_id ?? `name:${tx.clientName}`,
					characterName: tx.clientName,
					source: 'wallet-transactions',
					detail: `${tx.is_buy ? 'Bought' : 'Sold'} ${tx.quantity}x ${tx.typeName ?? tx.type_id} on ${fmtDate(tx.date)} for ${tx.totalValue} ISK`,
				})
			}
		}
	}

	// Scan contracts
	if (contracts) {
		for (const contract of contracts) {
			if (isBlacklisted(contract.issuer_id)) {
				matches.push({
					characterId: contract.issuer_id,
					characterName: contract.issuerName,
					source: 'contracts',
					detail: `Issuer of ${contract.type} contract (${contract.status}) issued ${fmtDate(contract.date_issued)}`,
				})
			} else if (isBlacklistedByName(false, contract.issuerName)) {
				matches.push({
					characterId: contract.issuer_id ?? `name:${contract.issuerName}`,
					characterName: contract.issuerName,
					source: 'contracts',
					detail: `Issuer of ${contract.type} contract (${contract.status}) issued ${fmtDate(contract.date_issued)}`,
				})
			}
			if (isBlacklisted(contract.acceptor_id)) {
				matches.push({
					characterId: contract.acceptor_id,
					characterName: contract.acceptorName,
					source: 'contracts',
					detail: `Acceptor of ${contract.type} contract (${contract.status}) issued ${fmtDate(contract.date_issued)}`,
				})
			} else if (isBlacklistedByName(false, contract.acceptorName)) {
				matches.push({
					characterId: contract.acceptor_id ?? `name:${contract.acceptorName}`,
					characterName: contract.acceptorName,
					source: 'contracts',
					detail: `Acceptor of ${contract.type} contract (${contract.status}) issued ${fmtDate(contract.date_issued)}`,
				})
			}
			if (isBlacklisted(contract.assignee_id) && contract.assignee_id !== contract.issuer_id) {
				matches.push({
					characterId: contract.assignee_id,
					characterName: contract.assigneeName,
					source: 'contracts',
					detail: `Assignee of ${contract.type} contract (${contract.status}) issued ${fmtDate(contract.date_issued)}`,
				})
			} else if (
				contract.assignee_id !== contract.issuer_id &&
				isBlacklistedByName(false, contract.assigneeName)
			) {
				matches.push({
					characterId: contract.assignee_id ?? `name:${contract.assigneeName}`,
					characterName: contract.assigneeName,
					source: 'contracts',
					detail: `Assignee of ${contract.type} contract (${contract.status}) issued ${fmtDate(contract.date_issued)}`,
				})
			}
		}
	}

	// Scan contacts (character type only — corps/alliances aren't in the blacklist)
	if (contacts) {
		for (const contact of contacts) {
			if (contact.contact_type === 'character' && isBlacklisted(contact.contact_id)) {
				matches.push({
					characterId: contact.contact_id,
					characterName: contact.contactName,
					source: 'contacts',
					detail: `In contacts with standing ${contact.standingFormatted ?? String(contact.standing)}`,
				})
			} else if (
				contact.contact_type === 'character' &&
				isBlacklistedByName(false, contact.contactName)
			) {
				matches.push({
					characterId: contact.contact_id ?? `name:${contact.contactName}`,
					characterName: contact.contactName,
					source: 'contacts',
					detail: `In contacts with standing ${contact.standingFormatted ?? String(contact.standing)}`,
				})
			}
		}
	}

	// Scan mails
	if (mails) {
		for (const mail of mails) {
			if (isBlacklisted(mail.from)) {
				matches.push({
					characterId: mail.from!,
					characterName: mail.fromName,
					source: 'mails',
					detail: `Sent mail "${mail.subject ?? '(no subject)'}" on ${fmtDate(mail.timestamp)}`,
				})
			} else if (isBlacklistedByName(false, mail.fromName)) {
				matches.push({
					characterId: mail.from ?? `name:${mail.fromName}`,
					characterName: mail.fromName,
					source: 'mails',
					detail: `Sent mail "${mail.subject ?? '(no subject)'}" on ${fmtDate(mail.timestamp)}`,
				})
			}
			if (mail.recipients) {
				for (const recipient of mail.recipients) {
					if (recipient.recipient_type === 'character' && isBlacklisted(recipient.recipient_id)) {
						matches.push({
							characterId: recipient.recipient_id,
							characterName: recipient.recipientName,
							source: 'mails',
							detail: `Received mail "${mail.subject ?? '(no subject)'}" on ${fmtDate(mail.timestamp)}`,
						})
					} else if (
						recipient.recipient_type === 'character' &&
						isBlacklistedByName(false, recipient.recipientName)
					) {
						matches.push({
							characterId: recipient.recipient_id ?? `name:${recipient.recipientName}`,
							characterName: recipient.recipientName,
							source: 'mails',
							detail: `Received mail "${mail.subject ?? '(no subject)'}" on ${fmtDate(mail.timestamp)}`,
						})
					}
				}
			}
		}
	}

	// Scan ship names (character IDs resolved from custom naming patterns)
	if (shipNameCharacterIds) {
		for (const [charId, { customName, characterName }] of shipNameCharacterIds) {
			if (isBlacklisted(charId)) {
				matches.push({
					characterId: charId,
					characterName,
					source: 'ship-names',
					detail: `Ship named "${customName}"`,
				})
			}
		}
	}

	if (matches.length === 0) return null

	// Group matches by character ID
	const grouped = new Map<string, BlacklistAssociationGroup>()
	for (const match of matches) {
		const existing = grouped.get(match.characterId)
		if (existing) {
			// Use the first resolved name we find
			if (!existing.characterName && match.characterName) {
				existing.characterName = match.characterName
			}
			existing.matches.push({ source: match.source, detail: match.detail })
		} else {
			grouped.set(match.characterId, {
				characterId: match.characterId,
				characterName: match.characterName,
				matches: [{ source: match.source, detail: match.detail }],
			})
		}
	}

	const SOURCE_DISPLAY_NAMES: Record<BlacklistMatch['source'], string> = {
		'wallet-journal': 'Wallet Journal',
		'wallet-transactions': 'Wallet Transactions',
		'contracts': 'Contracts',
		'contacts': 'Contacts',
		'mails': 'Mails',
		'ship-names': 'Ship Names',
	}

	const associations = [...grouped.values()]
	const uniqueCharacters = associations.length
	const totalHits = matches.length
	const sources = [...new Set(matches.map((m) => m.source))]

	const charSummaries = associations
		.slice(0, 5)
		.map((a) => {
			const name = a.characterName ?? a.characterId
			const count = a.matches.length
			return `${name} (${count} hit${count !== 1 ? 's' : ''})`
		})
		.join(', ')

	const suffix = uniqueCharacters > 5 ? ` and ${uniqueCharacters - 5} more` : ''

	return {
		id: 'blacklist-association',
		type: 'blacklist-association',
		severity: 'critical',
		title: 'Blacklisted Character Associations',
		description: `${uniqueCharacters} blacklisted character${uniqueCharacters !== 1 ? 's' : ''} found across ${sources.map((s) => SOURCE_DISPLAY_NAMES[s]).join(', ')}: ${charSummaries}${suffix}. Total ${totalHits} reference${totalHits !== 1 ? 's' : ''}.`,
		details: {
			associations,
			totalHits,
			uniqueCharacters,
			sources,
		},
	}
}
