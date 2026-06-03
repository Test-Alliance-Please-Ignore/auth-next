/**
 * Generate Alerts Step
 *
 * Reads processed report data from R2, runs all alert processors,
 * and stores the alert results. This step runs after all fetch/process
 * steps are done but before persist-sections.
 */

import {
    checkSpPlausibility,
    checkShipNameCrossmatch,
    checkPlexInjectorTrading,
    checkLargeIskTransfer,
    checkDataFetchFailures,
    checkCorpHopper,
    checkBlacklistAssociation,
    collectCustomShipNames,
    extractCandidateCharacterNames,
} from '../../processors/alerts'
import { getStub } from '@repo/do-utils'
import type { EsiTypeResolver } from '@repo/esi'
import { retrieveData, storeOrReturn } from '../../utils/storage'
import type { CoreBinding } from '../../../types/core-binding'

import type { StepResult } from '../../utils/storage'
import type { ProcessedPublicInfo } from '../../processors/helpers/public-info'
import type { ProcessedSkillsData } from '../../processors/helpers/skills'
import type { ProcessedWalletTransaction } from '../../processors/helpers/wallet-transactions'
import type { ProcessedContract } from '../../processors/helpers/contracts'
import type { ProcessedContact } from '../../processors/helpers/contacts'
import type { FittedShip } from '../../processors/helpers/ships'
import type { ProcessedCorpHistoryEntry } from '../../processors/helpers/corp-history'
import type { ProcessedWalletJournalEntry } from '../../processors/helpers/wallet-journal'
import type { EnrichedMailData } from '../../processors/helpers/mails'
import type { AssetNameMap } from '../assets/fetch-asset-names'
import type { ReportAlert, ReportAlerts, ResolvedCharacter } from '../../processors/alerts'

type LegacyAssociationItem = Awaited<
		ReturnType<CoreBinding['getLegacyAssociationsForCharacter']>
	>['items'][number]

function sanitizeLegacyBlacklistSignals(conflicts: Record<string, unknown>): Record<string, unknown> {
	const raw =
		conflicts && typeof conflicts === 'object' && conflicts.blacklistSignals && typeof conflicts.blacklistSignals === 'object'
			? (conflicts.blacklistSignals as Record<string, unknown>)
			: null
	if (!raw) return {}

	return {
		hasAnyBlacklistSignal: Boolean(raw.hasAnyBlacklistSignal),
		modernUserBlacklisted: Boolean(raw.modernUserBlacklisted),
		matchingDiscordUserIdsBlacklisted: Array.isArray(raw.matchingDiscordUserIdsBlacklisted)
			? raw.matchingDiscordUserIdsBlacklisted
			: [],
		ipAssociatedBlacklistedUsers: Array.isArray(raw.ipAssociatedBlacklistedUsers)
			? raw.ipAssociatedBlacklistedUsers
			: [],
		matchedTargets: Array.isArray(raw.matchedTargets)
			? raw.matchedTargets
			: [],
		matchingCharactersBlacklisted: Array.isArray(raw.matchingCharactersBlacklisted)
			? raw.matchingCharactersBlacklisted
			: [],
	}
}

function sanitizeLegacyAssociationItems(items: LegacyAssociationItem[]) {
	return items.map((item) => ({
		id: item.id,
		legacyAuthUserId: item.legacyAuthUserId,
		status: item.status,
		modernUserMainCharacterName: item.modernUserMainCharacterName,
		conflicts: {
			blacklistSignals: sanitizeLegacyBlacklistSignals(item.conflicts),
		},
		candidates: {
			characters: item.candidates.characters,
			notes: item.candidates.notes,
			ipAddressCount: item.candidates.ipAddressCount,
		},
	}))
}

/** Narrow interface for the HR DO methods we need */
interface HrBinding {
    checkCharactersBlacklisted(characterIds: string[]): Promise<Record<string, boolean>>
    checkCharacterNamesBlacklisted(characterNames: string[]): Promise<Record<string, boolean>>
    checkCharacterIdOrNamePairsBlacklisted(
        pairs: Array<{ characterId: string; characterName?: string }>,
    ): Promise<Array<{
        characterId: string
        characterName?: string
        isBlacklisted: boolean
        matchedBy: 'id' | 'name' | 'both' | 'none'
    }>>
}

/**
 * Resolve names to EVE character IDs using the shared ESI type resolver.
 * Returns only names that matched actual characters.
 */
async function resolveNamesToCharacters(
	esiTypeResolverBinding: DurableObjectNamespace,
	names: string[],
): Promise<ResolvedCharacter[]> {
    if (names.length === 0) return []

    try {
        const resolver = getStub<EsiTypeResolver>(esiTypeResolverBinding, 'global')
        const idMap = await resolver.resolveNames(names)
        return Object.entries(idMap).map(([name, characterId]) => ({
            name,
            characterId: Number(characterId),
        }))
    } catch (error) {
        console.warn('[generate-alerts] resolveNames call error:', error)
        return []
    }
}

/**
 * Get sibling character names for the same account via the CORE service binding.
 * Returns empty array on failure (non-critical).
 */
async function getSiblingCharacterNames(
    core: CoreBinding,
    characterId: string,
    characterName: string,
): Promise<string[]> {
    try {
        const ownership = await core.getCharacterOwnership(characterId)
        if (!ownership) return []

        const userDetails = await core.getUserDetails(ownership.userId)
        if (!userDetails) return []

        // Return all character names EXCEPT the report subject
        return userDetails.characters
            .map((c) => c.characterName)
            .filter((name) => name.toLowerCase() !== characterName.toLowerCase())
    } catch (error) {
        console.warn('[generate-alerts] Failed to get sibling characters:', error)
        return []
    }
}

function normalizeName(name: string): string {
    return name.trim().toLowerCase()
}

function collectBlacklistCandidates(
    walletJournal: ProcessedWalletJournalEntry[] | null,
    walletTransactions: ProcessedWalletTransaction[] | null,
    contracts: ProcessedContract[] | null,
    contacts: ProcessedContact[] | null,
    mails: EnrichedMailData | null,
    shipNameCharIds: Map<string, { customName: string; characterName: string }> | null,
): {
    idsOnly: string[]
    namesOnly: string[]
    pairs: Array<{ characterId: string; characterName: string }>
} {
    const idsOnly = new Set<string>()
    const namesOnly = new Set<string>()
    const pairMap = new Map<string, { characterId: string; characterName: string }>()

    const pushCandidate = (id?: string | null, name?: string | null) => {
        const trimmedId = id?.trim()
        const trimmedName = name?.trim()

        if (trimmedId && trimmedName) {
            pairMap.set(`${trimmedId}:${normalizeName(trimmedName)}`, {
                characterId: trimmedId,
                characterName: trimmedName,
            })
            return
        }

        if (trimmedId) idsOnly.add(trimmedId)
        if (trimmedName) namesOnly.add(trimmedName)
    }

    for (const entry of walletJournal ?? []) {
        pushCandidate(entry.first_party_id, entry.firstPartyName)
        pushCandidate(entry.second_party_id, entry.secondPartyName)
    }

    for (const tx of walletTransactions ?? []) {
        pushCandidate(tx.client_id, tx.clientName)
    }

    for (const contract of contracts ?? []) {
        pushCandidate(contract.issuer_id, contract.issuerName)
        pushCandidate(contract.acceptor_id, contract.acceptorName)
        pushCandidate(contract.assignee_id, contract.assigneeName)
    }

    for (const contact of contacts ?? []) {
        if (contact.contact_type === 'character') {
            pushCandidate(contact.contact_id, contact.contactName)
        }
    }

    for (const mail of mails?.mails ?? []) {
        pushCandidate(mail.from, mail.fromName)
        for (const recipient of mail.recipients ?? []) {
            if (recipient.recipient_type === 'character') {
                pushCandidate(recipient.recipient_id, recipient.recipientName)
            }
        }
    }

    for (const [charId, { characterName }] of shipNameCharIds ?? []) {
        pushCandidate(charId, characterName)
    }

    return {
        idsOnly: Array.from(idsOnly),
        namesOnly: Array.from(namesOnly),
        pairs: Array.from(pairMap.values()),
    }
}

export async function generateAlerts(
    core: CoreBinding,
    hr: HrBinding,
    esiTypeResolverBinding: DurableObjectNamespace,
    getBucket: (name: string) => R2Bucket,
    bucket: R2Bucket,
    bucketName: string,
    sectionResults: Record<string, StepResult>,
    workflowInstanceId: string,
    characterId: string,
): Promise<StepResult> {
    const alerts: ReportAlert[] = []

    try {
        // Alert 0: Check for any failed data fetches
        const fetchFailures = checkDataFetchFailures(sectionResults)
        alerts.push(...fetchFailures)

        // Retrieve all needed processed data from R2 (individually to avoid Promise.all fast-fail)
        const retrievalErrors: Record<string, string> = {}
        const safeRetrieve = async <T>(key: string): Promise<T | null> => {
            try {
                const stepResult = sectionResults[key]
                if (!stepResult) {
                    retrievalErrors[key] = 'No step result found'
                    return null
                }
                const data = await retrieveData<T>(getBucket, stepResult)
                if (!data) {
                    retrievalErrors[key] = 'retrieveData returned null'
                }
                return data
            } catch (err) {
                retrievalErrors[key] = err instanceof Error ? err.message : String(err)
                return null
            }
        }

        const [publicInfo, skills, rawTransactions, contracts, fittedShips, assetNameMap, corpHistory, walletJournal, contacts, enrichedMails] =
            await Promise.all([
                safeRetrieve<ProcessedPublicInfo>('process-public-info'),
                safeRetrieve<ProcessedSkillsData>('process-skills'),
                safeRetrieve<{ transactions: ProcessedWalletTransaction[]; truncated?: boolean } | ProcessedWalletTransaction[]>('process-wallet-transactions'),
                safeRetrieve<ProcessedContract[]>('process-contracts'),
                safeRetrieve<FittedShip[]>('process-fitted-ships'),
                safeRetrieve<AssetNameMap>('fetch-asset-names'),
                safeRetrieve<ProcessedCorpHistoryEntry[]>('process-corp-history'),
                safeRetrieve<ProcessedWalletJournalEntry[]>('process-wallet-journal'),
                safeRetrieve<ProcessedContact[]>('process-contacts'),
                safeRetrieve<EnrichedMailData>('process-mails'),
            ])

        if (Object.keys(retrievalErrors).length > 0) {
            console.warn('[generate-alerts] Retrieval errors:', retrievalErrors)
        }

        // Unwrap wallet transactions — process step stores as { transactions, truncated }
        const transactions: ProcessedWalletTransaction[] | null = rawTransactions
            ? Array.isArray(rawTransactions)
                ? rawTransactions
                : rawTransactions.transactions
            : null

        // Alert 1: SP Plausibility
        if (publicInfo && skills) {
            const spAlert = checkSpPlausibility(publicInfo, skills)
            if (spAlert) alerts.push(spAlert)
        }

        // Alert 2: Ship Name Cross-Match
        if (publicInfo && fittedShips) {
            const nameMap = assetNameMap ?? {}
            const customNames = collectCustomShipNames(nameMap, fittedShips)

            if (customNames.size > 0) {
                // Get sibling characters for exclusion
                const siblingNames = await getSiblingCharacterNames(
                    core,
                    characterId,
                    publicInfo.characterName,
                )

                // Extract candidate character names from naming patterns
                const { namesToResolve, candidateToCustomName } = extractCandidateCharacterNames(customNames)

                if (namesToResolve.length > 0) {
                    const resolvedCharacters = await resolveNamesToCharacters(esiTypeResolverBinding, namesToResolve)

                    const shipAlert = checkShipNameCrossmatch(
                        customNames,
                        resolvedCharacters,
                        candidateToCustomName,
                        publicInfo.characterName,
                        siblingNames,
                    )
                    if (shipAlert) alerts.push(shipAlert)
                }
            }
        }

        // Alert 3: PLEX/Injector Trading
        if (transactions || contracts) {
            const plexAlert = checkPlexInjectorTrading(transactions ?? [], contracts ?? [])
            if (plexAlert) alerts.push(plexAlert)
        }

        // Alert 4: Corp Hopper
        if (corpHistory) {
            const corpHopperAlert = checkCorpHopper(corpHistory)
            if (corpHopperAlert) alerts.push(corpHopperAlert)
        }

        // Alert 5: Large ISK Transfers
        if (walletJournal) {
            const iskAlert = checkLargeIskTransfer(walletJournal)
            if (iskAlert) alerts.push(iskAlert)
        }

        // Alert 6: Blacklist Association
        try {
            const mails = enrichedMails?.mails ?? null

            // Build ship name → character ID map from resolved characters (if available)
            let shipNameCharIds: Map<string, { customName: string; characterName: string }> | null = null
            if (publicInfo && fittedShips) {
                const nameMap = assetNameMap ?? {}
                const customNames = collectCustomShipNames(nameMap, fittedShips)
                if (customNames.size > 0) {
                    const { namesToResolve } = extractCandidateCharacterNames(customNames)
                    if (namesToResolve.length > 0) {
                        const resolved = await resolveNamesToCharacters(esiTypeResolverBinding, namesToResolve)
                        shipNameCharIds = new Map(
                            resolved.map((r) => {
                                const entry = customNames.get(r.name.toLowerCase())
                                return [String(r.characterId), { customName: entry?.customName ?? r.name, characterName: r.name }] as const
                            }),
                        )
                    }
                }
            }

            const candidates = collectBlacklistCandidates(
                walletJournal,
                transactions,
                contracts,
                contacts,
                enrichedMails ?? null,
                shipNameCharIds,
            )

            const [idsResult, namesResult, pairResults] = await Promise.all([
                candidates.idsOnly.length > 0
                    ? hr.checkCharactersBlacklisted(candidates.idsOnly)
                    : Promise.resolve<Record<string, boolean>>({}),
                candidates.namesOnly.length > 0
                    ? hr.checkCharacterNamesBlacklisted(candidates.namesOnly)
                    : Promise.resolve<Record<string, boolean>>({}),
                candidates.pairs.length > 0
                    ? hr.checkCharacterIdOrNamePairsBlacklisted(candidates.pairs)
                    : Promise.resolve([]),
            ])

            const blacklistedSet = new Set<string>()
            for (const [id, matched] of Object.entries(idsResult)) {
                if (matched) blacklistedSet.add(id)
            }

            const blacklistedNameSet = new Set<string>()
            for (const [name, matched] of Object.entries(namesResult)) {
                if (matched) blacklistedNameSet.add(normalizeName(name))
            }

            for (const pair of pairResults) {
                if (!pair.isBlacklisted) continue
                if (pair.matchedBy === 'id' || pair.matchedBy === 'both') {
                    blacklistedSet.add(pair.characterId)
                }
                if ((pair.matchedBy === 'name' || pair.matchedBy === 'both') && pair.characterName) {
                    blacklistedNameSet.add(normalizeName(pair.characterName))
                }
            }

            if (blacklistedSet.size > 0 || blacklistedNameSet.size > 0) {
                const blacklistAlert = checkBlacklistAssociation(
                    blacklistedSet,
                    blacklistedNameSet,
                    walletJournal,
                    transactions,
                    contracts,
                    contacts,
                    mails,
                    shipNameCharIds,
                    characterId,
                )
                if (blacklistAlert) alerts.push(blacklistAlert)
            }

            // Alert 7: IP-linked Blacklisted Users
            const ipAssociations = await core.getBlacklistedIpAssociationsForCharacter(characterId)
            if (ipAssociations.matches.length > 0) {
                const userCount = ipAssociations.matches.length
                const hashCount = new Set(
                    ipAssociations.matches.flatMap((match) => match.matchingIpHashes),
                ).size
                const sample = ipAssociations.matches
                    .slice(0, 3)
                    .map((match) => match.mainCharacterName ?? match.mainCharacterId)
                    .join(', ')
                const more = userCount > 3 ? ` and ${userCount - 3} more` : ''

                alerts.push({
                    id: 'ip-blacklist-association',
                    type: 'ip-blacklist-association',
                    severity: 'critical',
                    title: 'IP Association With Blacklisted Users',
                    description: `Shared IP hash history with ${userCount} blacklisted user${userCount !== 1 ? 's' : ''} across ${hashCount} hash${hashCount !== 1 ? 'es' : ''}: ${sample}${more}.`,
                    details: {
                        subjectUserId: ipAssociations.subjectUserId,
                        totalBlacklistedUsers: userCount,
                        uniqueMatchingHashes: hashCount,
                        matches: ipAssociations.matches,
                    },
                })
            }

            // Alert 8: Legacy additional association context + blacklist signals (read-only)
            const legacyAssociations = await core.getLegacyAssociationsForCharacter(characterId)
            if (legacyAssociations.items.length > 0) {
                const itemsWithBlacklistSignal = legacyAssociations.items.filter((item) => {
                    const signals =
                        item.conflicts && typeof item.conflicts === 'object'
                            ? (item.conflicts as Record<string, unknown>).blacklistSignals
                            : null
                    return (
                        Boolean(signals) &&
                        typeof signals === 'object' &&
                        Boolean((signals as Record<string, unknown>).hasAnyBlacklistSignal)
                    )
                })

                alerts.push({
                    id: 'legacy-additional-associations',
                    type: 'legacy-additional-associations',
                    severity: itemsWithBlacklistSignal.length > 0 ? 'high' : 'medium',
                    title: 'Legacy Additional Associations',
                    description:
                        itemsWithBlacklistSignal.length > 0
                            ? `${legacyAssociations.items.length} legacy association group(s) found; ${itemsWithBlacklistSignal.length} include blacklist signal(s).`
                            : `${legacyAssociations.items.length} legacy association group(s) found.`,
                    details: {
                        modernUserId: legacyAssociations.modernUserId,
                        items: sanitizeLegacyAssociationItems(legacyAssociations.items),
                    },
                })

                if (itemsWithBlacklistSignal.length > 0) {
                    alerts.push({
                        id: 'legacy-blacklist-association',
                        type: 'legacy-blacklist-association',
                        severity: 'critical',
                        title: 'Legacy Blacklist Association',
                        description: `${itemsWithBlacklistSignal.length} legacy association group(s) include blacklist matches.`,
                        details: {
                            modernUserId: legacyAssociations.modernUserId,
                            items: sanitizeLegacyAssociationItems(itemsWithBlacklistSignal),
                        },
                    })
                }
            }
        } catch (error) {
            console.warn('[generate-alerts] Blacklist association check failed:', error)
        }

        const result = {
            alerts,
            generatedAt: new Date().toISOString(),
        }

        return await storeOrReturn(bucket, bucketName, workflowInstanceId, 'generate-alerts', result)
    } catch (error) {
        console.error('[generate-alerts] Error generating alerts:', {
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            alertsCollectedBeforeError: alerts.length,
            alertTypesBeforeError: alerts.map((a) => a.type),
        })
        // Return empty alerts on failure — report generation should not fail because of alerts
        const result = {
            alerts: [] as ReportAlert[],
            generatedAt: new Date().toISOString(),
        }
        return await storeOrReturn(bucket, bucketName, workflowInstanceId, 'generate-alerts', result)
    }
}
