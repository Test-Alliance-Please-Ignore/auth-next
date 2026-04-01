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
    collectCustomShipNames,
    extractCandidateCharacterNames,
} from '../../processors/alerts'
import { retrieveData, storeOrReturn } from '../../utils/storage'

import type { StepResult } from '../../utils/storage'
import type { ProcessedPublicInfo } from '../../processors/helpers/public-info'
import type { ProcessedSkillsData } from '../../processors/helpers/skills'
import type { ProcessedWalletTransaction } from '../../processors/helpers/wallet-transactions'
import type { ProcessedContract } from '../../processors/helpers/contracts'
import type { FittedShip } from '../../processors/helpers/ships'
import type { ProcessedCorpHistoryEntry } from '../../processors/helpers/corp-history'
import type { ProcessedWalletJournalEntry } from '../../processors/helpers/wallet-journal'
import type { AssetNameMap } from '../assets/fetch-asset-names'
import type { ReportAlert, ReportAlerts, ResolvedCharacter } from '../../processors/alerts'

/** Narrow interface for the CORE service methods we need */
interface CoreBinding {
    getCharacterOwnership(
        characterId: string,
    ): Promise<{ userId: string; isPrimary: boolean } | null>
    getUserDetails(
        userId: string,
    ): Promise<{ characters: Array<{ characterName: string }> } | null>
}

interface UniverseIdsResponse {
    characters?: Array<{ id: number; name: string }>
}

/**
 * Resolve names to EVE character IDs using the public ESI endpoint.
 * Returns only names that matched actual characters.
 */
async function resolveNamesToCharacters(names: string[]): Promise<ResolvedCharacter[]> {
    if (names.length === 0) return []

    try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 30_000)
        let response: Response
        try {
            response = await fetch('https://esi.evetech.net/latest/universe/ids/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(names),
                signal: controller.signal,
            })
        } finally {
            clearTimeout(timeout)
        }

        if (!response.ok) {
            console.warn('[generate-alerts] universe/ids call failed:', response.status)
            return []
        }

        const data = await response.json<UniverseIdsResponse>()
        return (data.characters ?? []).map((c) => ({
            name: c.name,
            characterId: c.id,
        }))
    } catch (error) {
        console.warn('[generate-alerts] universe/ids call error:', error)
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

export async function generateAlerts(
    core: CoreBinding,
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

        const [publicInfo, skills, rawTransactions, contracts, fittedShips, assetNameMap, corpHistory, walletJournal] =
            await Promise.all([
                safeRetrieve<ProcessedPublicInfo>('process-public-info'),
                safeRetrieve<ProcessedSkillsData>('process-skills'),
                safeRetrieve<{ transactions: ProcessedWalletTransaction[]; truncated?: boolean } | ProcessedWalletTransaction[]>('process-wallet-transactions'),
                safeRetrieve<ProcessedContract[]>('process-contracts'),
                safeRetrieve<FittedShip[]>('process-fitted-ships'),
                safeRetrieve<AssetNameMap>('fetch-asset-names'),
                safeRetrieve<ProcessedCorpHistoryEntry[]>('process-corp-history'),
                safeRetrieve<ProcessedWalletJournalEntry[]>('process-wallet-journal'),
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
                    const resolvedCharacters = await resolveNamesToCharacters(namesToResolve)

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
