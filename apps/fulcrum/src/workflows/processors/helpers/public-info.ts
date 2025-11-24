import { getStub } from '@repo/do-utils'
import { stripHtmlToPlainText } from './html-stripper'

import type { CharacterPublicInfo, EsiTypeResolver } from '@repo/esi'

/**
 * Data enrichment functions for public character information
 * Resolves IDs to human-readable names using ESI Type Resolver
 */

/**
 * Enriched public character information with resolved names
 */
export interface ProcessedPublicInfo {
	characterId: string
	characterName: string
	birthday: string
	corporationId: string
	corporationName?: string
	allianceId?: string
	allianceName?: string
	securityStatus?: string
	gender: 'male' | 'female'
	raceId: string
	raceName?: string
	bloodlineId: string
	bloodlineName?: string
	factionId?: string
	factionName?: string
	description?: string
	title?: string
	processedAt: string
}

/**
 * Enrich character public info by resolving IDs to names
 * Uses ESI Type Resolver to batch resolve all IDs at once
 *
 * @param env - Worker environment with ESI_TYPE_RESOLVER binding
 * @param data - Character public info from ESI worker
 * @returns Enriched data with resolved names
 */
export async function enrichPublicInfo(
	env: { ESI_TYPE_RESOLVER: DurableObjectNamespace },
	data: CharacterPublicInfo
): Promise<ProcessedPublicInfo> {
	// Collect all IDs that need resolution
	const idsToResolve: string[] = [data.corporation_id]

	if (data.alliance_id) {
		idsToResolve.push(data.alliance_id)
	}

	if (data.faction_id) {
		idsToResolve.push(data.faction_id)
	}

	// Batch resolve all IDs at once using helper
	const typeResolver = getStub<EsiTypeResolver>(env.ESI_TYPE_RESOLVER, 'global')
	const nameMap = await typeResolver.resolveIds(idsToResolve)

	console.log('[enrichPublicInfo] Resolution complete', {
		idsToResolve,
		nameMapSize: Object.keys(nameMap).length,
		sampleNameMapEntries: Object.entries(nameMap).slice(0, 5),
		corporationId: data.corporation_id,
		corporationName: nameMap[data.corporation_id],
		allianceId: data.alliance_id,
		allianceName: data.alliance_id ? nameMap[data.alliance_id] : undefined,
	})

	// Build enriched data with resolved names
	return {
		characterId: data.name, // ESI doesn't return character_id in public info
		characterName: data.name,
		birthday: data.birthday,
		corporationId: data.corporation_id,
		corporationName: nameMap[data.corporation_id],
		allianceId: data.alliance_id,
		allianceName: data.alliance_id ? nameMap[data.alliance_id] : undefined,
		securityStatus: data.security_status,
		gender: data.gender,
		raceId: data.race_id,
		raceName: nameMap[data.race_id],
		bloodlineId: data.bloodline_id,
		bloodlineName: nameMap[data.bloodline_id],
		factionId: data.faction_id,
		factionName: data.faction_id ? nameMap[data.faction_id] : undefined,
		description: stripHtmlToPlainText(data.description),
		title: data.title,
		processedAt: new Date().toISOString(),
	}
}
