import { getStub } from '@repo/do-utils'
import {
	CharacterDeletedError,
	EsiRequestClient,
	buildEsiUserKey,
	buildPublicEsiUserKey,
	type CharacterKillmailBasic,
	type EsiCacheAdapter,
	type EsiCacheScopeContext,
	type EsiResponse,
} from '@repo/esi'
import { EsiRateLimitStore } from '@repo/esi-rate-limit'
import { logger } from '@repo/hono-helpers'
import { killmailDetailSchema, type KillmailDetail } from '@repo/universe'
import { parseJsonResponse } from '@repo/worker-utils'

import type { EveTokenStore } from '@repo/eve-token-store'
import type { Env } from '../context'

type SerializedCacheEntry<T> = {
	data: T
	expiresAt: string | null
	etag: string | null
	pages: number | null
	page: number | null
	scope: EsiCacheScopeContext['scope']
	scopeId: string
	lastModified?: string
}

const DEFAULT_GLOBAL_CACHE_TTL_SECONDS = 5 * 60
const MAX_CACHE_AGE_MS = 12 * 60 * 60 * 1000
const NOOP_CACHE_WARNING_PREFIX = '[SrpKillmailCache]'

function isExpired<T extends { expiresAt: Date | null; lastModified?: Date | null }>(
	response: T
): boolean {
	const now = Date.now()

	if (response.lastModified) {
		const age = now - response.lastModified.getTime()
		if (age > MAX_CACHE_AGE_MS) {
			return true
		}
	}

	if (!response.expiresAt) {
		return false
	}

	return now > response.expiresAt.getTime()
}

class SrpKillmailCache implements EsiCacheAdapter {
	private readonly localCache = new Map<string, string>()

	constructor(private readonly cache?: KVNamespace) {}

	private getCacheKey(scope: EsiCacheScopeContext, path: string, page?: number): string {
		const baseKey = `esi:${scope.scope}:${scope.scopeId}:${path}`
		return page !== undefined ? `${baseKey}:page:${page}` : baseKey
	}

	private calculateGlobalTtlSeconds(expiresAt: Date | null): number | null {
		if (!expiresAt) {
			return DEFAULT_GLOBAL_CACHE_TTL_SECONDS
		}

		const ttlMs = expiresAt.getTime() - Date.now()
		if (ttlMs <= 0) {
			return null
		}

		return Math.max(1, Math.floor(ttlMs / 1000))
	}

	private async parseCachedResponse<T>(cacheKey: string): Promise<EsiResponse<T> | null> {
		try {
			const cached = this.cache
				? await this.cache.get<string>(cacheKey)
				: this.localCache.get(cacheKey) ?? null
			if (!cached) {
				return null
			}

			const parsed = JSON.parse(cached) as SerializedCacheEntry<T>
			return {
				data: parsed.data,
				expiresAt: parsed.expiresAt ? new Date(parsed.expiresAt) : null,
				etag: parsed.etag,
				pages: parsed.pages,
				page: parsed.page,
				lastModified: parsed.lastModified ? new Date(parsed.lastModified) : undefined,
			}
		} catch (error) {
			logger.warn('[SrpKillmailCache] Failed to parse cache entry', {
				cacheKey,
				error: error instanceof Error ? error.message : String(error),
			})
			if (this.cache) {
				await this.cache.delete(cacheKey)
			} else {
				this.localCache.delete(cacheKey)
			}
			return null
		}
	}

	async getCachedResponse<T>(
		scope: EsiCacheScopeContext,
		path: string,
		page?: number,
		includeExpired = false
	): Promise<EsiResponse<T> | null> {
		const cacheKey = this.getCacheKey(scope, path, page)
		const cachedResponse = await this.parseCachedResponse<T>(cacheKey)

		if (!cachedResponse) {
			return null
		}

		if (isExpired(cachedResponse) && !includeExpired) {
			if (this.cache) {
				await this.cache.delete(cacheKey)
			} else {
				this.localCache.delete(cacheKey)
			}
			return null
		}

		return cachedResponse
	}

	async setCachedResponse<T>(
		scope: EsiCacheScopeContext,
		path: string,
		response: EsiResponse<T>,
		page?: number,
		options?: { persistGlobal?: boolean }
	): Promise<void> {
		if (options?.persistGlobal === false) {
			return
		}

		const cacheKey = this.getCacheKey(scope, path, page)
		const ttlSeconds = this.calculateGlobalTtlSeconds(response.expiresAt ?? null)

		if (ttlSeconds === null) {
			return
		}

		const serialized: SerializedCacheEntry<T> = {
			data: response.data,
			expiresAt: response.expiresAt ? response.expiresAt.toISOString() : null,
			etag: response.etag,
			page: response.page,
			pages: response.pages,
			scope: scope.scope,
			scopeId: scope.scopeId,
			lastModified: response.lastModified?.toISOString(),
		}

		try {
			if (this.cache) {
				await this.cache.put(cacheKey, JSON.stringify(serialized), {
					expirationTtl: ttlSeconds,
				})
			} else {
				this.localCache.set(cacheKey, JSON.stringify(serialized))
			}
		} catch (error) {
			logger.warn('[SrpKillmailCache] Failed to persist cache entry', {
				cacheKey,
				error: error instanceof Error ? error.message : String(error),
			})
		}
	}
}

export class SrpKillmailNotFoundError extends Error {
	constructor(public readonly path: string) {
		super(`Killmail not found for ${path}`)
		this.name = 'SrpKillmailNotFoundError'
	}
}

export class SrpKillmailEsiClient {
	private readonly cache: SrpKillmailCache
	private readonly rateLimits: EsiRateLimitStore
	private readonly requestClient: EsiRequestClient

	constructor(private readonly env: Env) {
		if (!env.ESI_GLOBAL_CACHE) {
			logger.warn(`${NOOP_CACHE_WARNING_PREFIX} ESI_GLOBAL_CACHE binding missing; using in-memory fallback`)
		}
		this.cache = new SrpKillmailCache(env.ESI_GLOBAL_CACHE)
		this.rateLimits = new EsiRateLimitStore(env.ESI_RATE_LIMITS)
		this.requestClient = new EsiRequestClient({
			rateLimits: this.rateLimits,
			cache: this.cache,
			debugLogger: logger,
			compatibilityDate: '2025-11-06',
		})
	}

	private async fetchCharacterAccessToken(characterId: string): Promise<string> {
		const tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		const token = await tokenStore.getAccessToken(characterId)
		if (!token) {
			throw new Error(`No access token available for character ${characterId}`)
		}
		return token
	}

	private async buildRequestError(response: Response, body: string, path: string): Promise<Error> {
		if (response.status === 404 && body.includes('Character has been deleted')) {
			const charMatch = path.match(/\/characters\/(\d+)/)
			if (charMatch?.[1]) {
				const deletedCharId = charMatch[1]
				try {
					await getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default').markCharacterDeleted(
						deletedCharId
					)
				} catch (error) {
					logger.warn('[SrpKillmailEsiClient] Failed to mark character as deleted', {
						characterId: deletedCharId,
						error: error instanceof Error ? error.message : String(error),
					})
				}
				throw new CharacterDeletedError(deletedCharId)
			}
		}

		if (response.status === 404) {
			return new SrpKillmailNotFoundError(path)
		}

		return new Error(
			`ESI request failed: ${response.status} ${response.statusText || 'Request Failed'} - ${
				body || 'Unknown ESI error'
			} | path=${path}`
		)
	}

	async fetchCharacterKillmailPage(
		characterId: string,
		page: number
	): Promise<{ data: CharacterKillmailBasic[]; pages: number }> {
		const path = `/characters/${characterId}/killmails/recent?page=${page}`
		const result = await this.requestClient.request<CharacterKillmailBasic[]>({
			path,
			userKey: buildEsiUserKey(this.env.EVE_SSO_CLIENT_ID, characterId),
			cacheScope: { scope: 'character', scopeId: characterId },
			accessTokenFactory: () => this.fetchCharacterAccessToken(characterId),
			parse: async (response) => {
				const data = await parseJsonResponse<Array<{ killmail_id: number; killmail_hash: string }>>(
					response as Response,
					{
						context: `ESI character killmail page ${characterId} page ${page}`,
					}
				)
				return data.map((killmail) => ({
					...killmail,
					killmail_id: String(killmail.killmail_id),
				}))
			},
			buildError: ({ response, body, path: errorPath }) =>
				this.buildRequestError(response, body, errorPath),
		})

		return {
			data: result.data,
			pages: result.pages ?? 1,
		}
	}

	async fetchCharacterKillmailDetail(
		characterId: string,
		killmailId: string,
		killmailHash: string
	): Promise<KillmailDetail | null> {
		try {
			const result = await this.requestClient.request<KillmailDetail>({
				path: `/killmails/${killmailId}/${killmailHash}`,
				userKey: buildPublicEsiUserKey(),
				cacheScope: { scope: 'public', scopeId: 'public' },
				parse: async (response) =>
					killmailDetailSchema.parse(
						await parseJsonResponse<KillmailDetail>(response as Response, {
							context: `ESI killmail ${characterId}/${killmailId}/${killmailHash}`,
						})
					),
				buildError: ({ response, body, path }) => this.buildRequestError(response, body, path),
			})

			return result.data
		} catch (error) {
			if (error instanceof SrpKillmailNotFoundError) {
				return null
			}
			throw error
		}
	}
}
