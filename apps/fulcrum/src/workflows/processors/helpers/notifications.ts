import { getStub } from '@repo/do-utils'
import { normalizeIdToString } from '@repo/eve-types'

import type { EsiTypeResolver, CharacterNotification } from '@repo/esi'
import type {
    CharacterAffiliationCoordinator,
    CharacterAffiliationDisplayCandidate,
} from './character-affiliation'
import type { EntityLinkCoordinator } from './entity-links'
import type { CoreBinding } from '../../../types/core-binding'
import { logger } from '@repo/hono-helpers'

export interface ProcessedNotification extends CharacterNotification {
    senderName?: string
    senderDisplayName?: string
    senderDisplayHref?: string
    /** Parsed text content as key-value pairs (IDs resolved to names where possible) */
    parsedText?: Record<string, string>
    processedAt: string
}

export interface EnrichedNotificationData {
    notifications: ProcessedNotification[]
    /** Distinct notification types present */
    types: string[]
}

/**
 * Parse EVE notification text (YAML-like format) into key-value pairs.
 * Handles YAML anchors (&idXXX value) and references (*idXXX).
 *
 * EVE notification text typically looks like:
 *   amount: 10000000
 *   structureID: &id001 1051346234914
 *   corpStationID: *id001
 */
function parseNotificationText(text?: string): Record<string, string> | undefined {
    if (!text) return undefined
    const result: Record<string, string> = {}
    const anchors: Record<string, string> = {}
    const lines = text.split('\n')
    for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        const colonIdx = trimmed.indexOf(':')
        if (colonIdx > 0) {
            const key = trimmed.slice(0, colonIdx).trim()
            let value = trimmed.slice(colonIdx + 1).trim()

            // Handle YAML anchor: "&id001 1051346234914" → store anchor and extract value
            const anchorMatch = value.match(/^&(\S+)\s+(.+)$/)
            if (anchorMatch) {
                anchors[anchorMatch[1]] = anchorMatch[2]
                value = anchorMatch[2]
            }

            // Handle YAML reference: "*id001" → resolve to anchor value
            const refMatch = value.match(/^\*(\S+)$/)
            if (refMatch && anchors[refMatch[1]]) {
                value = anchors[refMatch[1]]
            }

            if (key) result[key] = value
        } else {
            // Line without colon — store as-is
            result[trimmed] = ''
        }
    }
    return Object.keys(result).length > 0 ? result : undefined
}

// Keys whose values are known to be EVE entity/type IDs worth resolving.
// Matched case-insensitively against parsedText keys.
const ID_KEY_SUFFIXES = [
    'corpid', 'corporationid', 'allianceid', 'charid', 'characterid',
    'typeid', 'solarsystemid', 'systemid', 'stationid', 'structureid',
    'factionid', 'aggressorid', 'declaredbyid', 'againstid', 'defenderid',
    'attackerid', 'senderid', 'ownerid', 'victimid', 'locationid',
    'shiptypeid', 'destroyerid', 'podkillerid', 'clonestationid',
    'ceoid', 'quitterid', 'opponentid', 'allyid', 'mercid',
    'offeredid', 'entityid', 'constellationid', 'planetid',
    'invokingcharid',
]

// Keys that end in "ID" but do NOT represent resolvable EVE entities.
// These would poison /universe/names/ batches causing entire batches to fail.
const NON_ENTITY_ID_KEYS = new Set([
    'killmailid',
    'warnegotiationid',
    'itemid',
])

/**
 * Check if a parsedText key looks like it contains an entity ID.
 * Matches keys ending with common ID suffixes (case-insensitive),
 * excluding known non-entity keys.
 */
function isIdKey(key: string): boolean {
    const lower = key.toLowerCase()
    if (NON_ENTITY_ID_KEYS.has(lower)) return false
    return ID_KEY_SUFFIXES.some((suffix) => lower === suffix || lower.endsWith(suffix))
}

/**
 * Check if a value looks like a valid EVE numeric ID.
 * Must be a positive integer within plausible EVE ID ranges.
 * Allows up to 13 digits to cover structure IDs (1T–2T range).
 */
function isPlausibleId(value: string): boolean {
    if (!value || value.length > 13) return false
    const num = Number(value)
    return Number.isInteger(num) && num > 0 && num < 2_000_000_000_000
}

/**
 * Collect all entity IDs from parsedText that need resolution.
 */
function collectParsedTextIds(
    notifications: Array<{ parsedText?: Record<string, string> }>,
): Set<string> {
    const ids = new Set<string>()
    for (const n of notifications) {
        if (!n.parsedText) continue
        for (const [key, value] of Object.entries(n.parsedText)) {
            if (isIdKey(key) && isPlausibleId(value)) {
                ids.add(value)
            }
        }
    }
    return ids
}

/**
 * Replace raw IDs in parsedText with resolved names.
 */
function annotateParsedText(
    parsedText: Record<string, string>,
    nameMap: Record<string, string>,
): Record<string, string> {
    const result: Record<string, string> = {}
    for (const [key, value] of Object.entries(parsedText)) {
        if (isIdKey(key) && isPlausibleId(value) && nameMap[value]) {
            result[key] = `${nameMap[value]} (${value})`
        } else {
            result[key] = value
        }
    }
    return result
}

export async function enrichNotifications(
    env: {
        ESI_TYPE_RESOLVER: DurableObjectNamespace
        ESI: DurableObjectNamespace
        EVE_TOKEN_STORE: DurableObjectNamespace
        CORE: CoreBinding
    },
    notifications: CharacterNotification[],
    characterId?: string,
    affiliationCoordinator?: CharacterAffiliationCoordinator,
    entityLinkCoordinator?: EntityLinkCoordinator,
): Promise<EnrichedNotificationData> {
    if (notifications.length === 0) {
        return { notifications: [], types: [] }
    }

    // First pass: parse all notification text
    const parsed = notifications.map((n) => ({
        ...n,
        parsedText: parseNotificationText(n.text),
    }))

    // Collect all IDs to resolve: sender IDs + IDs from parsedText
    const idsToResolve = new Set<string>()
    for (const n of parsed) {
        const senderId = normalizeIdToString(n.sender_id)
        if (senderId) idsToResolve.add(senderId)
    }
    const parsedTextIds = collectParsedTextIds(parsed)
    for (const id of parsedTextIds) {
        idsToResolve.add(id)
    }

    // Batch-resolve all IDs in one call
    let nameMap: Record<string, string> = {}
    if (idsToResolve.size > 0) {
        try {
            const typeResolver = getStub<EsiTypeResolver>(env.ESI_TYPE_RESOLVER, 'global')
            nameMap = await typeResolver.resolveIds(Array.from(idsToResolve), characterId)
        } catch (error) {
            logger.error('Failed to resolve IDs for notifications:', error)
        }
    }

    const senderDisplayNameMap =
        affiliationCoordinator && notifications.length > 0
            ? await affiliationCoordinator.resolveDisplayNames(
                    { ESI: env.ESI },
                    characterId ?? 'default',
                    (() => {
                        const candidates: CharacterAffiliationDisplayCandidate[] = []
                        for (const notification of parsed) {
                            if (notification.sender_type !== 'character') continue
                            const senderId = normalizeIdToString(notification.sender_id)
                            if (senderId && nameMap[senderId]) {
                                candidates.push({
                                    characterId: senderId,
                                    characterName: nameMap[senderId],
                                    forceCharacter: true,
                                })
                            }
                        }
                        return candidates
                    })(),
                    'enrichNotifications',
                )
            : {}

    const displayHrefMap =
        entityLinkCoordinator && notifications.length > 0
            ? await entityLinkCoordinator.resolveDisplayHrefs(
                    env.CORE,
                    notifications.map((notification) => ({
                        entityId: String(notification.sender_id ?? ''),
                        entityType: notification.sender_type ?? null,
                    })),
                    'enrichNotifications',
                )
            : {}

    // Second pass: build processed notifications with resolved names
    const processed: ProcessedNotification[] = parsed.map((n) => {
        const senderId = normalizeIdToString(n.sender_id)
        return {
            ...n,
            senderName: senderId ? nameMap[senderId] : undefined,
            senderDisplayName: senderId ? senderDisplayNameMap[senderId] ?? nameMap[senderId] : undefined,
            senderDisplayHref: senderId ? displayHrefMap[senderId] : undefined,
            parsedText: n.parsedText
                ? annotateParsedText(n.parsedText, nameMap)
                : undefined,
            processedAt: new Date().toISOString(),
        }
    })

    // Sort newest first
    processed.sort((a, b) => {
        const timeA = a.timestamp ? new Date(a.timestamp).getTime() : 0
        const timeB = b.timestamp ? new Date(b.timestamp).getTime() : 0
        return timeB - timeA
    })

    // Collect distinct types
    const types = [...new Set(processed.map((n) => n.type))].sort()

    return { notifications: processed, types }
}
