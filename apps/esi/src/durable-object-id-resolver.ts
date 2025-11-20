import { DurableObject } from 'cloudflare:workers'

import { getStub } from '@repo/do-utils'
import { getIdClassification, isStructureId, normalizeEntityType } from '@repo/esi'
import { logger } from '@repo/hono-helpers'

import type { Esi, EsiTypeResolver, IdRangeType } from '@repo/esi'
import type { Env } from './context'

const TYPE_RESOLVER_GLOBAL_CACHE_TTL_SECONDS = 30 * 24 * 60 * 60 // 30 days

const UNIVERSE_SUPPORTED_RANGE_TYPES = new Set<IdRangeType>([
	'various',
	'faction',
	'npc_corporation',
	'npc_character',
	'character',
	'dust_character',
	'corporation',
	'alliance',
	'legacy_entity',
	'region',
	'constellation',
	'solar_system',
	'station',
])

export class EsiTypeResolverDO extends DurableObject<Env> implements EsiTypeResolver {
	private readonly globalCache: KVNamespace

	constructor(
		public state: DurableObjectState,
		public env: Env
	) {
		super(state, env)
		this.globalCache = env.ESI_GLOBAL_CACHE
	}

	private getEntityCacheKey(id: string): string {
		return `entity:${id}`
	}

	private async getLocalEntityName(cacheKey: string): Promise<string | null> {
		try {
			const cached = await this.state.storage.kv.get<string>(cacheKey)
			return cached ?? null
		} catch (error) {
			logger.withTags({ cacheKey, operation: 'local_read' }).warn('Entity cache read failed', error)
			return null
		}
	}

	private async setLocalEntityName(cacheKey: string, name: string): Promise<void> {
		try {
			await this.state.storage.kv.put(cacheKey, name)
		} catch (error) {
			logger
				.withTags({ cacheKey, operation: 'local_write' })
				.warn('Entity cache write failed', error)
		}
	}

	private async getGlobalEntityName(cacheKey: string): Promise<string | null> {
		try {
			const cached = await this.globalCache.get(cacheKey)
			return cached ?? null
		} catch (error) {
			logger
				.withTags({ cacheKey, operation: 'global_read' })
				.warn('Global cache read failed', error)
			return null
		}
	}

	private async setGlobalEntityName(cacheKey: string, name: string): Promise<void> {
		try {
			await this.globalCache.put(cacheKey, name, {
				expirationTtl: TYPE_RESOLVER_GLOBAL_CACHE_TTL_SECONDS,
			})
		} catch (error) {
			logger
				.withTags({ cacheKey, operation: 'global_write' })
				.warn('Global cache write failed', error)
		}
	}

	/**
	 * Resolves EVE IDs to names via the `/universe/names/` bulk endpoint.
	 * Supported ID's for resolving are: Characters, Corporations, Alliances, Stations,
	 * Solar Systems, Constellations, Regions, Types, Factions
	 * Falls back to cached values stored in Durable Object KV.
	 * @param ids - Array of entity IDs to resolve.
	 * @returns Map of ID to display name for successfully resolved entities.
	 */
	private async resolveUniverseNames(ids: string[]): Promise<Record<string, string>> {
		if (ids.length === 0) {
			return {}
		}

		try {
			const integerIds = ids.map((id) => parseInt(id, 10)).filter((id) => !isNaN(id))

			if (integerIds.length === 0) {
				return {}
			}

			const BATCH_SIZE = 1000
			const batches: number[][] = []
			for (let i = 0; i < integerIds.length; i += BATCH_SIZE) {
				batches.push(integerIds.slice(i, i + BATCH_SIZE))
			}

			logger
				.withTags({
					totalIds: integerIds.length,
					batchCount: batches.length,
					batchSize: BATCH_SIZE,
				})
				.info('Resolving IDs from ESI in batches')

			const batchResults = await Promise.all(
				batches.map(async (batch) => {
					const response = await fetch('https://esi.evetech.net/latest/universe/names/', {
						method: 'POST',
						headers: {
							'X-Compatibility-Date': '2025-09-30',
							'Content-Type': 'application/json',
						},
						body: JSON.stringify(batch),
					})

					if (!response.ok) {
						const errorText = await response.text()
						logger
							.withTags({ status: response.status, errorText, batchSize: batch.length })
							.error('ESI ID resolution batch failed')
						return []
					}

					return response.json<Array<{ id: number; name: string; category: string }>>()
				})
			)

			const resolved: Record<string, string> = {}
			const data = batchResults.flat()

			logger
				.withTags({
					resolvedCount: data.length,
					requestedCount: integerIds.length,
				})
				.info('ID resolution completed')

			for (const entity of data) {
				const entityId = String(entity.id)
				resolved[entityId] = entity.name
				const cacheKey = this.getEntityCacheKey(entityId)
				await this.setLocalEntityName(cacheKey, entity.name)
				await this.setGlobalEntityName(cacheKey, entity.name)
			}

			return resolved
		} catch (error) {
			logger.error(error)
			return {}
		}
	}

	private async checkCacheForId(id: string): Promise<string | null> {
		const cacheKey = this.getEntityCacheKey(id)
		const localCached = await this.getLocalEntityName(cacheKey)

		if (localCached !== null) {
			return localCached
		}

		const globalCached = await this.getGlobalEntityName(cacheKey)
		if (globalCached !== null) {
			await this.setLocalEntityName(cacheKey, globalCached)
			return globalCached
		}

		return null
	}

	/**
	 * Resolves structure IDs to names via authenticated ESI calls or cache
	 * If character ID is provided, attempts authenticated fetch
	 * Falls back to cache, then to default message if unavailable
	 * @param structureIds - Array of structure IDs to resolve
	 * @param withCharacterId - Optional character ID for authenticated structure lookups
	 * @returns Map of structure ID to display name
	 */
	private async resolveStructureNames(
		structureIds: string[],
		withCharacterId?: string
	): Promise<Record<string, string>> {
		if (structureIds.length === 0) {
			return {}
		}

		const result: Record<string, string> = {}

		for (const structureId of structureIds) {
			// Check cache first
			const cached = await this.checkCacheForId(structureId)
			if (cached !== null) {
				result[structureId] = cached
				continue
			}

			// If character ID is provided, try authenticated fetch
			if (withCharacterId) {
				try {
					const esiStub = getStub<Esi>(this.env.ESI, withCharacterId)
					const structureInfo = await esiStub.fetchStructureInfo(withCharacterId, structureId)
					if (structureInfo) {
						const structureName = structureInfo.name
						result[structureId] = structureName
						// Cache the result
						const cacheKey = this.getEntityCacheKey(structureId)
						await this.setLocalEntityName(cacheKey, structureName)
						await this.setGlobalEntityName(cacheKey, structureName)
						continue
					}
				} catch (error) {
					logger
						.withTags({
							structureId,
							characterId: withCharacterId,
							error: error instanceof Error ? error.message : String(error),
						})
						.warn('Failed to fetch structure info')
				}
			}

			// If not cached and no character or fetch failed, return default message
			result[structureId] = 'Structure (Unknown or no access)'
		}

		return result
	}

	async resolveIds(ids: string[], withCharacterId?: string): Promise<Record<string, string>> {
		if (ids.length === 0) {
			return {}
		}

		const result: Record<string, string> = {}
		const idsToResolve: string[] = []

		// Check cache for each ID (local first, then global KV; failures treated as cache miss)
		for (const id of ids) {
			const cached = await this.checkCacheForId(id)
			if (cached !== null) {
				result[id] = cached
			} else {
				idsToResolve.push(id)
			}
		}

		// If all IDs are cached, return early
		if (idsToResolve.length === 0) {
			return result
		}

		const universeIds: string[] = []
		const structureIds: string[] = []

		for (const id of idsToResolve) {
			const classification = getIdClassification(id)
			const normalizedType = normalizeEntityType(classification.type)

			if (normalizedType === 'structure' || isStructureId(id)) {
				structureIds.push(id)
			} else if (UNIVERSE_SUPPORTED_RANGE_TYPES.has(normalizedType)) {
				universeIds.push(id)
			} else {
				logger
					.withTags({ id, classification: classification.type, normalizedType })
					.debug('Skipping unsupported ID for universe resolver')
			}
		}

		// Resolve universe names
		const fetched = await this.resolveUniverseNames(universeIds)
		Object.assign(result, fetched)

		// Resolve structure names
		const structureNames = await this.resolveStructureNames(structureIds, withCharacterId)
		Object.assign(result, structureNames)

		return result
	}
}
