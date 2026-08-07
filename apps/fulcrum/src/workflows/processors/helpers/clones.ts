/**
 * Data enrichment functions for character clones
 * Resolves implant type IDs and location IDs to human-readable names
 */

import { getStub } from '@repo/do-utils'
import { isStructureId } from '@repo/eve-types'
import { logger } from '@repo/hono-helpers'

import { StructureResolutionCoordinator } from './structure-resolution'

import type { CharacterClones, CharacterImplants, EsiTypeResolver, JumpClone } from '@repo/esi'

/**
 * Enriched jump clone with resolved names
 */
export interface ProcessedJumpClone extends JumpClone {
	locationName?: string
	implantNames: string[]
}

/**
 * Enriched clones data with resolved names
 */
export interface ProcessedClones {
	home_location?: CharacterClones['home_location'] & {
		locationName?: string
	}
	jump_clones: ProcessedJumpClone[]
	last_clone_jump_date?: string
	last_station_change_date?: string
	active_implants: Array<{
		type_id: string
		name?: string
	}>
}

/**
 * Enrich clones data by resolving implant type IDs and location IDs to names
 */
export async function enrichClones(
	env: {
		ESI_TYPE_RESOLVER: DurableObjectNamespace
		ESI: DurableObjectNamespace
	},
	clones: CharacterClones,
	implants: CharacterImplants,
	characterId: string,
	structureResolutionCoordinator?: StructureResolutionCoordinator
): Promise<ProcessedClones> {
	// Collect all IDs that need resolution
	const allImplantIds = new Set<string>()
	const stationLocationIds = new Set<string>()
	const structureLocationIds = new Set<string>()

	// Collect implant IDs from jump clones
	for (const clone of clones.jump_clones) {
		for (const implantId of clone.implants) {
			allImplantIds.add(implantId)
		}
		if (isStructureId(clone.location_id)) {
			structureLocationIds.add(clone.location_id)
		} else {
			stationLocationIds.add(clone.location_id)
		}
	}

	// Collect active implant IDs
	for (const implantId of implants) {
		allImplantIds.add(implantId)
	}

	// Collect home location
	if (clones.home_location) {
		if (isStructureId(clones.home_location.location_id)) {
			structureLocationIds.add(clones.home_location.location_id)
		} else {
			stationLocationIds.add(clones.home_location.location_id)
		}
	}

	// Batch resolve all IDs via type resolver (implant types + station locations)
	const idsToResolve = [...allImplantIds, ...stationLocationIds]
	const typeResolver = getStub<EsiTypeResolver>(env.ESI_TYPE_RESOLVER, 'global')
	const nameMap = await typeResolver.resolveIds(idsToResolve)

	// Resolve structure locations via authenticated ESI calls
	const structureNameMap =
		structureLocationIds.size > 0
			? await (
					structureResolutionCoordinator ?? new StructureResolutionCoordinator()
				).resolveStructureNames({ ESI: env.ESI }, characterId, structureLocationIds, 'enrichClones')
			: {}

	if (structureLocationIds.size > 0) {
		logger.log('[enrichClones] Structure resolution complete', {
			requested: structureLocationIds.size,
			resolved: Object.keys(structureNameMap).length,
			denied: structureResolutionCoordinator?.getDeniedCount() ?? 0,
		})
	}

	// Helper to resolve a location ID to a name
	const resolveLocation = (locationId: string): string | undefined => {
		if (isStructureId(locationId)) {
			return structureNameMap[locationId]
		}
		return nameMap[locationId]
	}

	// Build enriched result
	const processedJumpClones: ProcessedJumpClone[] = clones.jump_clones.map((clone) => ({
		...clone,
		locationName: resolveLocation(clone.location_id),
		implantNames: clone.implants.map((id) => nameMap[id] ?? id),
	}))

	const activeImplants = implants.map((typeId) => ({
		type_id: typeId,
		name: nameMap[typeId],
	}))

	return {
		home_location: clones.home_location
			? {
					...clones.home_location,
					locationName: resolveLocation(clones.home_location.location_id),
				}
			: undefined,
		jump_clones: processedJumpClones,
		last_clone_jump_date: clones.last_clone_jump_date,
		last_station_change_date: clones.last_station_change_date,
		active_implants: activeImplants,
	}
}
