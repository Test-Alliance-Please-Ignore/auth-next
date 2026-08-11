import { and, eq, inArray, or } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'
import { logger, TimeCache } from '@repo/hono-helpers'

import { managedCorporations, userCharacters } from '../db/schema'

import type { EveCorporationData } from '@repo/eve-corporation-data'
import type { App } from '../context'

type Db = NonNullable<App['Variables']['db']>

const STRUCTURE_ACCESS_CACHE_TTL_MS = 30 * 1000

const implicitStructureAccessCache = new TimeCache<string[]>(STRUCTURE_ACCESS_CACHE_TTL_MS)

/**
 * Resolve the corporations for which a user's linked characters are persisted
 * as CEO/director representatives. This is intentionally user-scoped: callers
 * cannot supply a character list and use it as an authorization claim.
 */
export async function getImplicitStructureAccessCorporationIds(
	env: App['Bindings'],
	db: Db | undefined,
	userId: string
): Promise<string[]> {
	if (!db) {
		return []
	}

	return implicitStructureAccessCache.getOrSet(`structure-access:${userId}`, async () => {
		const characters = await db.query.userCharacters.findMany({
			where: and(
				eq(userCharacters.userId, userId),
				eq(userCharacters.isDeleted, false),
				eq(userCharacters.status, 'active')
			),
			columns: {
				characterId: true,
				corporationId: true,
			},
		})

		const characterIdsByCorporation = new Map<string, Set<string>>()
		for (const character of characters) {
			if (!character.corporationId) continue
			const characterIds = characterIdsByCorporation.get(character.corporationId) ?? new Set()
			characterIds.add(character.characterId)
			characterIdsByCorporation.set(character.corporationId, characterIds)
		}

		const corporationIds = [...characterIdsByCorporation.keys()]
		if (corporationIds.length === 0) {
			return []
		}

		const managed = await db.query.managedCorporations.findMany({
			where: and(
				inArray(managedCorporations.corporationId, corporationIds),
				eq(managedCorporations.isActive, true),
				eq(managedCorporations.includeInStructureAssetSync, true),
				eq(managedCorporations.isAltCorp, false),
				or(
					eq(managedCorporations.isMemberCorporation, true),
					eq(managedCorporations.isSpecialPurpose, true)
				)
			),
			columns: {
				corporationId: true,
			},
		})

		const eligibleCorporationIds = new Set(managed.map((row) => row.corporationId))
		const accessCorporationIds: string[] = []

		for (const corporationId of eligibleCorporationIds) {
			const characterIds = characterIdsByCorporation.get(corporationId)
			if (!characterIds) continue

			try {
				const corporationData = getStub<EveCorporationData>(env.EVE_CORPORATION_DATA, corporationId)
				const [corporationInfo, directors] = await Promise.all([
					corporationData.getCorporationInfo(corporationId),
					corporationData.getDirectors(corporationId),
				])

				const isCeo = corporationInfo?.ceoId
					? characterIds.has(String(corporationInfo.ceoId))
					: false
				const isDirector = directors.some((director) =>
					characterIds.has(String(director.characterId))
				)

				if (isCeo || isDirector) {
					accessCorporationIds.push(corporationId)
				}
			} catch (error) {
				logger.warn('[StructureAccess] Failed to resolve persisted CEO/director roster', {
					userId,
					corporationId,
					error: error instanceof Error ? error.message : String(error),
				})
			}
		}

		return accessCorporationIds.sort()
	})
}

export function invalidateImplicitStructureAccess(userId: string): void {
	implicitStructureAccessCache.delete(`structure-access:${userId}`)
}
