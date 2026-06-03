import { DurableObject } from 'cloudflare:workers'

import { getStub } from '@repo/do-utils'
import {
	EsiRequestClient,
	getIdClassification,
	isStructureId,
	normalizeEntityType,
} from '@repo/esi'
import {
	buildPublicEsiUserKey,
	EsiRateLimitStore,
	normalizeEsiRouteKey,
	parseEsiRateLimitHeaders,
} from '@repo/esi-rate-limit'
import { logger } from '@repo/hono-helpers'

import type { Esi, EsiTypeResolver, IdRangeType } from '@repo/esi'
import type { Universe } from '@repo/universe'
import type { Env } from './context'

// ---------------------------------------------------------------------------
// Type resolver TTLs
// ---------------------------------------------------------------------------
// Character / corp / alliance names almost never change, so keep the shared
// KV cache around for a long time.
const TYPE_RESOLVER_GLOBAL_CACHE_TTL_SECONDS = 365 * 24 * 60 * 60 // 365 days
const CACHE_CHECK_CONCURRENCY = 20
const CACHE_WRITE_CONCURRENCY = 10
const STRUCTURE_RESOLVE_CONCURRENCY = 3

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

async function forEachWithConcurrency<T>(
	items: T[],
	concurrency: number,
	worker: (item: T) => Promise<void>
): Promise<void> {
	if (items.length === 0) return

	const queue = [...items]
	const workerCount = Math.min(concurrency, queue.length)

	await Promise.all(
		Array.from({ length: workerCount }, async () => {
			while (queue.length > 0) {
				const item = queue.shift()
				if (!item) return
				await worker(item)
			}
		})
	)
}

export class EsiTypeResolverDO extends DurableObject<Env> implements EsiTypeResolver {
	private readonly globalCache: KVNamespace
	private readonly esiRateLimits: EsiRateLimitStore
	private readonly requestClient: EsiRequestClient

	constructor(
		public state: DurableObjectState,
		public env: Env
	) {
		super(state, env)
		this.globalCache = env.ESI_GLOBAL_CACHE
		this.esiRateLimits = new EsiRateLimitStore(env.ESI_RATE_LIMITS)
		this.requestClient = new EsiRequestClient({
			rateLimits: this.esiRateLimits,
			debugLogger: logger,
			compatibilityDate: '2025-09-30',
		})
	}

	private getEntityCacheKey(id: string): string {
		return `entity:${id}`
	}

	private getEntityNameCacheKey(name: string): string {
		return `entity-name:${name}`
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

	private async getLocalEntityId(cacheKey: string): Promise<string | null> {
		try {
			const cached = await this.state.storage.kv.get<string>(cacheKey)
			return cached ?? null
		} catch (error) {
			logger.withTags({ cacheKey, operation: 'local_read' }).warn('Entity cache read failed', error)
			return null
		}
	}

	private async setLocalEntityId(cacheKey: string, id: string): Promise<void> {
		try {
			await this.state.storage.kv.put(cacheKey, id)
		} catch (error) {
			logger
				.withTags({ cacheKey, operation: 'local_write' })
				.warn('Entity cache write failed', error)
		}
	}

	private async getGlobalEntityId(cacheKey: string): Promise<string | null> {
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

	private async setGlobalEntityId(cacheKey: string, id: string): Promise<void> {
		try {
			await this.globalCache.put(cacheKey, id, {
				expirationTtl: TYPE_RESOLVER_GLOBAL_CACHE_TTL_SECONDS,
			})
		} catch (error) {
			logger
				.withTags({ cacheKey, operation: 'global_write' })
				.warn('Global cache write failed', error)
		}
	}

	private parseHeaderSeconds(headers: Headers, headerName: string): number | undefined {
		const raw = headers.get(headerName)
		if (!raw) return undefined
		const parsed = Number.parseInt(raw, 10)
		return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
	}

	private buildBatchSample<T>(items: T[], limit = 5): T[] {
		return items.slice(0, limit)
	}

	private getPublicEsiUserKey(): string {
		return buildPublicEsiUserKey()
	}

	private async assertEsiRateLimitAllowance(path: string, userKey: string): Promise<void> {
		const routeKey = normalizeEsiRouteKey(path)
		const now = Date.now()

		const routeGroup = await this.esiRateLimits.getRouteGroup(routeKey)
		if (routeGroup) {
			const bucket = await this.esiRateLimits.getBucketSnapshot(routeGroup, userKey)
			if (bucket) {
				const retryAfterSeconds =
					bucket.retryAfterSeconds ?? Math.max(1, Math.ceil((bucket.expiresAtMs - now) / 1000))
				throw new Error(
					`ESI request failed: 429 Too Many Requests - {"error":"ESI rate limit active"} | metadata=${JSON.stringify(
						{
							status: 429,
							path,
							retryAfterSeconds,
							circuitBreaker: 'bucket',
							routeKey,
							routeGroup,
						}
					)}`
				)
			}
		}

		const routeErrorLimit = await this.esiRateLimits.getRouteErrorLimit(routeKey, userKey)
		if (routeErrorLimit) {
			const retryAfterSeconds =
				routeErrorLimit.retryAfterSeconds ??
				Math.max(1, Math.ceil((routeErrorLimit.expiresAtMs - now) / 1000))
			throw new Error(
				`ESI request failed: 429 Too Many Requests - {"error":"ESI rate limit active"} | metadata=${JSON.stringify(
					{
						status: 429,
						path,
						retryAfterSeconds,
						circuitBreaker: 'error_limit',
						routeKey,
						routeGroup,
					}
				)}`
			)
		}

		const routeCooldown = await this.esiRateLimits.getRouteCooldown(routeKey, userKey)
		if (routeCooldown) {
			const retryAfterSeconds =
				routeCooldown.retryAfterSeconds ??
				Math.max(1, Math.ceil((routeCooldown.expiresAtMs - now) / 1000))
			throw new Error(
				`ESI request failed: 429 Too Many Requests - {"error":"ESI rate limit active"} | metadata=${JSON.stringify(
					{
						status: 429,
						path,
						retryAfterSeconds,
						circuitBreaker: 'route_breaker',
						routeKey,
						routeGroup,
					}
				)}`
			)
		}
	}

	private async updateEsiRateLimitState(
		path: string,
		headers: Headers,
		status: number,
		userKey: string
	): Promise<void> {
		const routeKey = normalizeEsiRouteKey(path)
		const snapshot = parseEsiRateLimitHeaders(headers)
		const now = Date.now()

		if (snapshot.group) {
			await this.esiRateLimits.rememberRouteGroup(routeKey, snapshot.group)
		}

		if (snapshot.errorLimitRemain !== undefined && snapshot.errorLimitResetSeconds !== undefined) {
			await this.esiRateLimits.putRouteErrorLimit({
				userKey,
				routeKey,
				remaining: snapshot.errorLimitRemain,
				limit: snapshot.errorLimitRemain,
				used: snapshot.used,
				windowSeconds: snapshot.errorLimitResetSeconds,
				retryAfterSeconds: snapshot.retryAfterSeconds,
				observedAtMs: now,
				expiresAtMs: now + snapshot.errorLimitResetSeconds * 1000,
			})
			return
		}

		if (snapshot.group && snapshot.limit !== undefined && snapshot.windowSeconds !== undefined) {
			const remaining = snapshot.remaining ?? snapshot.limit
			const used = snapshot.used ?? Math.max(0, snapshot.limit - remaining)
			await this.esiRateLimits.putBucketSnapshot({
				group: snapshot.group,
				userKey,
				routeKey,
				status,
				limit: snapshot.limit,
				remaining,
				used,
				windowSeconds: snapshot.windowSeconds,
				retryAfterSeconds: snapshot.retryAfterSeconds,
				observedAtMs: now,
				expiresAtMs: now + snapshot.windowSeconds * 1000,
			})
			return
		}

		if (status === 429) {
			const retryAfterSeconds = snapshot.retryAfterSeconds ?? snapshot.errorLimitResetSeconds
			if (retryAfterSeconds !== undefined) {
				await this.esiRateLimits.putRouteCooldown({
					userKey,
					routeKey,
					retryAfterSeconds,
					observedAtMs: now,
					expiresAtMs: now + retryAfterSeconds * 1000,
				})
			}
		}
	}

	/**
	 * Fetch names from ESI /universe/names/ for a batch of IDs.
	 * On 404 (caused by any unresolvable ID in the batch), bisects the batch
	 * and retries each half so one bad ID doesn't poison the entire batch.
	 */
	private async fetchUniverseNamesBatch(
		ids: number[]
	): Promise<Array<{ id: number; name: string; category: string }>> {
		if (ids.length === 0) return []

		const userKey = this.getPublicEsiUserKey()

		try {
			const response = await this.requestClient.request<
				Array<{ id: number; name: string; category: string }>
			>({
				path: '/universe/names/',
				userKey,
				method: 'POST',
				jsonBody: ids,
				buildError: async ({ response, body }) =>
					new Error(
						`ESI request failed: ${response.status} ${response.statusText} - ${body || 'Unknown error'}`
					),
				parse: (response) => response.json<Array<{ id: number; name: string; category: string }>>(),
			})
			return response.data
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			const context = {
				route: '/universe/names/',
				batchSize: ids.length,
				sampleIds: this.buildBatchSample(ids),
				error: message,
			}
			if (message.includes('"status":429')) {
				logger.withTags({ ...context, status: 429 }).warn('ESI rate limited while resolving IDs')
				return []
			}
			if (message.includes('404')) {
				// Single ID failed — it's unresolvable, skip it
				if (ids.length === 1) {
					logger.withTags({ ...context, id: ids[0], status: 404 }).debug('Skipping unresolvable ID')
					return []
				}
			}
			if (ids.length === 1) {
				logger.withTags({ ...context, id: ids[0] }).warn('Failed to resolve ID from ESI')
				return []
			}

			logger.withTags(context).warn('ESI batch failed, bisecting to isolate bad IDs')

			const mid = Math.floor(ids.length / 2)
			const [left, right] = await Promise.all([
				this.fetchUniverseNamesBatch(ids.slice(0, mid)),
				this.fetchUniverseNamesBatch(ids.slice(mid)),
			])
			return [...left, ...right]
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

		let requestedCount = 0
		let batchCount = 0
		try {
			const integerIds = ids.map((id) => parseInt(id, 10)).filter((id) => !isNaN(id))

			if (integerIds.length === 0) {
				return {}
			}
			requestedCount = integerIds.length

			const BATCH_SIZE = 1000
			const batches: number[][] = []
			for (let i = 0; i < integerIds.length; i += BATCH_SIZE) {
				batches.push(integerIds.slice(i, i + BATCH_SIZE))
			}
			batchCount = batches.length

			logger
				.withTags({
					totalIds: integerIds.length,
					batchCount: batches.length,
					batchSize: BATCH_SIZE,
				})
				.debug('Resolving IDs from ESI in batches')

			const batchResults: Array<Array<{ id: number; name: string; category: string }>> = []
			for (const batch of batches) {
				batchResults.push(await this.fetchUniverseNamesBatch(batch))
			}

			const resolved: Record<string, string> = {}
			const data = batchResults.flat()

			logger
				.withTags({
					resolvedCount: data.length,
					requestedCount: integerIds.length,
				})
				.debug('ID resolution completed')

			await forEachWithConcurrency(data, CACHE_WRITE_CONCURRENCY, async (entity) => {
				const entityId = String(entity.id)
				resolved[entityId] = entity.name
				const cacheKey = this.getEntityCacheKey(entityId)
				await this.setLocalEntityName(cacheKey, entity.name)
				await this.setGlobalEntityName(cacheKey, entity.name)
			})

			return resolved
		} catch (error) {
			logger
				.withTags({
					route: '/universe/names/',
					requestedCount,
					batchCount,
					error: error instanceof Error ? error.message : String(error),
				})
				.error('ID resolution failed')
			return {}
		}
	}

	private async fetchUniverseIdsBatch(
		names: string[]
	): Promise<Array<{ id: number; name: string; category: string }>> {
		if (names.length === 0) return []

		const userKey = this.getPublicEsiUserKey()

		try {
			const response = await this.requestClient.request<{
				alliances?: Array<{ id: number; name: string }>
				characters?: Array<{ id: number; name: string }>
				corporations?: Array<{ id: number; name: string }>
				systems?: Array<{ id: number; name: string }>
				[key: string]: Array<{ id: number; name: string }> | undefined
			}>({
				path: '/universe/ids/',
				userKey,
				method: 'POST',
				jsonBody: names,
				buildError: async ({ response, body }) =>
					new Error(
						`ESI request failed: ${response.status} ${response.statusText} - ${body || 'Unknown error'}`
					),
				parse: (response) =>
					response.json<{
						alliances?: Array<{ id: number; name: string }>
						characters?: Array<{ id: number; name: string }>
						corporations?: Array<{ id: number; name: string }>
						systems?: Array<{ id: number; name: string }>
						[key: string]: Array<{ id: number; name: string }> | undefined
					}>(),
			})
			const data = response.data

			const flattened: Array<{ id: number; name: string; category: string }> = []
			for (const [entityType, entities] of Object.entries(data)) {
				if (!entities) continue
				for (const entity of entities) {
					flattened.push({
						id: entity.id,
						name: entity.name,
						category: entityType === 'systems' ? 'solar_system' : entityType.slice(0, -1),
					})
				}
			}
			return flattened
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			const context = {
				route: '/universe/ids/',
				batchSize: names.length,
				sampleNames: this.buildBatchSample(names),
				error: message,
			}
			if (message.includes('"status":429')) {
				logger.withTags({ ...context, status: 429 }).warn('ESI rate limited while resolving names')
				return []
			}
			if (message.includes('404')) {
				if (names.length === 1) {
					logger
						.withTags({ ...context, name: names[0], status: 404 })
						.debug('Skipping unresolvable name')
					return []
				}
			}
			if (names.length === 1) {
				logger.withTags({ ...context, name: names[0] }).warn('Failed to resolve name from ESI')
				return []
			}

			logger.withTags(context).warn('ESI batch failed, bisecting to isolate bad names')

			const mid = Math.floor(names.length / 2)
			const [left, right] = await Promise.all([
				this.fetchUniverseIdsBatch(names.slice(0, mid)),
				this.fetchUniverseIdsBatch(names.slice(mid)),
			])
			return [...left, ...right]
		}
	}

	/**
	 * Resolves EVE names to IDs via the `/universe/ids/` bulk endpoint.
	 * Falls back to cached values stored in Durable Object KV.
	 */
	async resolveNames(names: string[]): Promise<Record<string, string>> {
		if (names.length === 0) {
			return {}
		}

		let requestedCount = 0
		let batchCount = 0
		try {
			const result: Record<string, string> = {}
			const namesToResolve: string[] = []

			for (const name of names) {
				const cacheKey = this.getEntityNameCacheKey(name)
				const localCached = await this.getLocalEntityId(cacheKey)
				if (localCached !== null) {
					result[name] = localCached
					continue
				}

				const globalCached = await this.getGlobalEntityId(cacheKey)
				if (globalCached !== null) {
					result[name] = globalCached
					await this.setLocalEntityId(cacheKey, globalCached)
					continue
				}

				namesToResolve.push(name)
			}

			if (namesToResolve.length === 0) {
				return result
			}
			requestedCount = namesToResolve.length

			const BATCH_SIZE = 1000
			const batches: string[][] = []
			for (let i = 0; i < namesToResolve.length; i += BATCH_SIZE) {
				batches.push(namesToResolve.slice(i, i + BATCH_SIZE))
			}
			batchCount = batches.length

			logger
				.withTags({
					totalNames: namesToResolve.length,
					batchCount: batches.length,
					batchSize: BATCH_SIZE,
				})
				.debug('Resolving names from ESI in batches')

			for (const batch of batches) {
				const batchResults = await this.fetchUniverseIdsBatch(batch)
				for (const entity of batchResults) {
					const entityId = String(entity.id)
					result[entity.name] = entityId
					const cacheKey = this.getEntityNameCacheKey(entity.name)
					await this.setLocalEntityId(cacheKey, entityId)
					await this.setGlobalEntityId(cacheKey, entityId)
				}
			}

			return result
		} catch (error) {
			logger
				.withTags({
					route: '/universe/ids/',
					requestedCount,
					batchCount,
					error: error instanceof Error ? error.message : String(error),
				})
				.error('Name resolution failed')
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

	private async cacheResolvedNames(resolved: Record<string, string>): Promise<void> {
		const entries = Object.entries(resolved)
		await forEachWithConcurrency(entries, CACHE_WRITE_CONCURRENCY, async ([id, name]) => {
			const cacheKey = this.getEntityCacheKey(id)
			await this.setLocalEntityName(cacheKey, name)
			await this.setGlobalEntityName(cacheKey, name)
		})
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

		const esiStub = withCharacterId ? getStub<Esi>(this.env.ESI, withCharacterId) : null

		await forEachWithConcurrency(
			structureIds,
			STRUCTURE_RESOLVE_CONCURRENCY,
			async (structureId) => {
				// Check cache first
				const cached = await this.checkCacheForId(structureId)
				if (cached !== null) {
					result[structureId] = cached
					return
				}

				// If character ID is provided, try authenticated fetch
				if (withCharacterId && esiStub) {
					try {
						const structureInfo = await esiStub.fetchStructureInfo(withCharacterId, structureId)
						if (structureInfo) {
							const structureName = structureInfo.name
							result[structureId] = structureName
							// Cache the result
							const cacheKey = this.getEntityCacheKey(structureId)
							await this.setLocalEntityName(cacheKey, structureName)
							await this.setGlobalEntityName(cacheKey, structureName)
							return
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
		)

		return result
	}

	/**
	 * Resolves NPC station IDs from the local Universe DO database.
	 * Falls back to ESI /universe/names/ for unresolved station IDs.
	 */
	private async resolveNpcStationNames(stationIds: string[]): Promise<Record<string, string>> {
		if (stationIds.length === 0) {
			return {}
		}

		try {
			const universeStub = getStub<Universe>(this.env.UNIVERSE, 'default')
			const stationMap = await universeStub.resolveNpcStationsByIds(stationIds)
			const result: Record<string, string> = {}

			for (const stationId of stationIds) {
				const station = stationMap[stationId]
				if (!station) {
					continue
				}

				result[stationId] = station.stationName
			}

			await this.cacheResolvedNames(result)

			logger
				.withTags({
					requestedCount: stationIds.length,
					resolvedCount: Object.keys(result).length,
				})
				.info('Resolved NPC station IDs from Universe DO')

			return result
		} catch (error) {
			logger
				.withTags({ stationCount: stationIds.length })
				.warn('Failed to resolve NPC station IDs from Universe DO', error)
			return {}
		}
	}

	private async resolveRegionNames(regionIds: string[]): Promise<Record<string, string>> {
		if (regionIds.length === 0) {
			return {}
		}

		try {
			const universeStub = getStub<Universe>(this.env.UNIVERSE, 'default')
			const regionMap = await universeStub.resolveRegionsByIds(regionIds)
			const result: Record<string, string> = {}

			for (const regionId of regionIds) {
				const region = regionMap[regionId]
				if (region?.regionName) {
					result[regionId] = region.regionName
				}
			}

			await this.cacheResolvedNames(result)

			logger
				.withTags({
					requestedCount: regionIds.length,
					resolvedCount: Object.keys(result).length,
				})
				.info('Resolved region IDs from Universe DO')

			return result
		} catch (error) {
			logger
				.withTags({ regionCount: regionIds.length })
				.warn('Failed to resolve region IDs from Universe DO', error)
			return {}
		}
	}

	private async resolveSolarSystemNames(solarSystemIds: string[]): Promise<Record<string, string>> {
		if (solarSystemIds.length === 0) {
			return {}
		}

		try {
			const universeStub = getStub<Universe>(this.env.UNIVERSE, 'default')
			const systemMap = await universeStub.resolveSolarSystemsByIds(solarSystemIds)
			const result: Record<string, string> = {}

			for (const systemId of solarSystemIds) {
				const system = systemMap[systemId]
				if (system?.solarSystemName) {
					result[systemId] = system.solarSystemName
				}
			}

			await this.cacheResolvedNames(result)

			logger
				.withTags({
					requestedCount: solarSystemIds.length,
					resolvedCount: Object.keys(result).length,
				})
				.info('Resolved solar system IDs from Universe DO')

			return result
		} catch (error) {
			logger
				.withTags({ solarSystemCount: solarSystemIds.length })
				.warn('Failed to resolve solar system IDs from Universe DO', error)
			return {}
		}
	}

	private async resolveStargateNames(stargateIds: string[]): Promise<Record<string, string>> {
		if (stargateIds.length === 0) {
			return {}
		}

		try {
			const universeStub = getStub<Universe>(this.env.UNIVERSE, 'default')
			const stargateMap = await universeStub.resolveStargatesByIds(stargateIds)
			const result: Record<string, string> = {}

			for (const stargateId of stargateIds) {
				const stargate = stargateMap[stargateId]
				if (stargate?.stargateName) {
					result[stargateId] = stargate.stargateName
				}
			}

			await this.cacheResolvedNames(result)

			logger
				.withTags({
					requestedCount: stargateIds.length,
					resolvedCount: Object.keys(result).length,
				})
				.info('Resolved stargate IDs from Universe DO')

			return result
		} catch (error) {
			logger
				.withTags({ stargateCount: stargateIds.length })
				.warn('Failed to resolve stargate IDs from Universe DO', error)
			return {}
		}
	}

	private async resolveCelestialNames(celestialIds: string[]): Promise<Record<string, string>> {
		if (celestialIds.length === 0) {
			return {}
		}

		try {
			const universeStub = getStub<Universe>(this.env.UNIVERSE, 'default')
			const [planetMap, staticMoonMap] = await Promise.all([
				universeStub.resolvePlanetsByIds(celestialIds),
				universeStub.resolveStaticMoonsByIds(celestialIds),
			])
			const result: Record<string, string> = {}

			for (const celestialId of celestialIds) {
				const planet = planetMap[celestialId]
				if (planet?.planetName) {
					result[celestialId] = planet.planetName
					continue
				}

				const moon = staticMoonMap[celestialId]
				if (moon?.moonName) {
					result[celestialId] = moon.moonName
				}
			}

			await this.cacheResolvedNames(result)

			logger
				.withTags({
					requestedCount: celestialIds.length,
					resolvedCount: Object.keys(result).length,
				})
				.info('Resolved celestial IDs from Universe DO')

			return result
		} catch (error) {
			logger
				.withTags({ celestialCount: celestialIds.length })
				.warn('Failed to resolve celestial IDs from Universe DO', error)
			return {}
		}
	}

	private async resolveTypeNames(typeIds: string[]): Promise<Record<string, string>> {
		if (typeIds.length === 0) {
			return {}
		}

		try {
			const universeStub = getStub<Universe>(this.env.UNIVERSE, 'default')
			const typeMap = await universeStub.resolveTypeNamesByIds(typeIds)
			const result: Record<string, string> = {}

			for (const typeId of typeIds) {
				const type = typeMap[typeId]
				if (type?.typeName) {
					result[typeId] = type.typeName
				}
			}

			await this.cacheResolvedNames(result)

			logger
				.withTags({
					requestedCount: typeIds.length,
					resolvedCount: Object.keys(result).length,
				})
				.info('Resolved type IDs from Universe DO')

			return result
		} catch (error) {
			logger
				.withTags({ typeCount: typeIds.length })
				.warn('Failed to resolve type IDs from Universe DO', error)
			return {}
		}
	}

	async resolveIds(ids: string[], withCharacterId?: string): Promise<Record<string, string>> {
		if (ids.length === 0) {
			return {}
		}

		const result: Record<string, string> = {}

		const universeIds = new Set<string>()
		const typeIds = new Set<string>()
		const regionIds = new Set<string>()
		const solarSystemIds = new Set<string>()
		const stationIds = new Set<string>()
		const stargateIds = new Set<string>()
		const celestialIds = new Set<string>()
		const structureIds = new Set<string>()

		for (const id of ids) {
			const classification = getIdClassification(id)
			const normalizedType = normalizeEntityType(classification.type)

			if (normalizedType === 'structure' || isStructureId(id)) {
				structureIds.add(id)
			} else if (normalizedType === 'various') {
				// Most inventory type IDs (including skills) are in the "various" range.
				// Resolve against local SDE type data first, then fall back to ESI names.
				typeIds.add(id)
			} else if (normalizedType === 'region') {
				regionIds.add(id)
			} else if (normalizedType === 'solar_system') {
				solarSystemIds.add(id)
			} else if (normalizedType === 'station') {
				stationIds.add(id)
			} else if (normalizedType === 'stargate') {
				stargateIds.add(id)
			} else if (normalizedType === 'celestial') {
				celestialIds.add(id)
			} else if (UNIVERSE_SUPPORTED_RANGE_TYPES.has(normalizedType)) {
				universeIds.add(id)
			} else {
				logger
					.withTags({ id, classification: classification.type, normalizedType })
					.debug('Skipping unsupported ID for universe resolver')
			}
		}

		const universeIdsToResolve = new Set<string>()
		await forEachWithConcurrency(Array.from(universeIds), CACHE_CHECK_CONCURRENCY, async (id) => {
			const cached = await this.checkCacheForId(id)
			if (cached !== null) {
				result[id] = cached
				return
			}
			universeIdsToResolve.add(id)
		})

		// Resolve inventory type IDs (including skills) from local Universe DB first.
		const typeNames = await this.resolveTypeNames(Array.from(typeIds))
		Object.assign(result, typeNames)
		for (const typeId of typeIds) {
			if (!(typeId in typeNames)) {
				universeIdsToResolve.add(typeId)
			}
		}

		// Resolve region IDs from local Universe DB first.
		const regionNames = await this.resolveRegionNames(Array.from(regionIds))
		Object.assign(result, regionNames)
		for (const regionId of regionIds) {
			if (!(regionId in regionNames)) {
				universeIdsToResolve.add(regionId)
			}
		}

		// Resolve solar system IDs from local Universe DB first.
		const solarSystemNames = await this.resolveSolarSystemNames(Array.from(solarSystemIds))
		Object.assign(result, solarSystemNames)
		for (const solarSystemId of solarSystemIds) {
			if (!(solarSystemId in solarSystemNames)) {
				universeIdsToResolve.add(solarSystemId)
			}
		}

		// Resolve known NPC stations from local Universe DB first.
		// Any unresolved station IDs fall back to ESI /universe/names/.
		const stationNames = await this.resolveNpcStationNames(Array.from(stationIds))
		Object.assign(result, stationNames)
		for (const stationId of stationIds) {
			if (!(stationId in stationNames)) {
				universeIdsToResolve.add(stationId)
			}
		}

		// Resolve stargate IDs from local Universe DB first.
		const stargateNames = await this.resolveStargateNames(Array.from(stargateIds))
		Object.assign(result, stargateNames)
		for (const stargateId of stargateIds) {
			if (!(stargateId in stargateNames)) {
				universeIdsToResolve.add(stargateId)
			}
		}

		// Resolve celestial IDs from local Universe DB first (planets + static moons).
		const celestialNames = await this.resolveCelestialNames(Array.from(celestialIds))
		Object.assign(result, celestialNames)
		for (const celestialId of celestialIds) {
			if (!(celestialId in celestialNames)) {
				universeIdsToResolve.add(celestialId)
			}
		}

		// Resolve universe names
		const fetched = await this.resolveUniverseNames(Array.from(universeIdsToResolve))
		Object.assign(result, fetched)

		// Resolve structure names
		const structureNames = await this.resolveStructureNames(
			Array.from(structureIds),
			withCharacterId
		)
		Object.assign(result, structureNames)

		return result
	}
}
