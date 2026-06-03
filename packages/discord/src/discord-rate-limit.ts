import { parseJsonResponse } from '@repo/worker-utils'

type DiscordRateLimitBody = {
	global?: boolean
	retry_after?: number
	message?: string
}

export type DiscordRateLimitObservation = {
	bucket?: string | null
	global: boolean
	remaining?: number | null
	resetAfterMs?: number | null
	retryAfterMs?: number | null
	scope?: string | null
}

export type DiscordRateLimitRecord = {
	bucket?: string | null
	expiresAt: number
	global: boolean
	scope?: string | null
	routeKey: string
}

export interface DiscordRateLimitStore {
	get(key: string): Promise<DiscordRateLimitRecord | null>
	put(key: string, value: DiscordRateLimitRecord, ttlSeconds: number): Promise<void>
	delete?(key: string): Promise<void>
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

function normalizeDiscordPath(pathname: string): string {
	return pathname.replace(/\/\d{5,}(?=\/|$)/g, '/:id')
}

function parseRetryAfterSeconds(value: string | null | undefined): number | null {
	if (!value) {
		return null
	}

	const seconds = Number.parseFloat(value)
	if (!Number.isFinite(seconds) || seconds <= 0) {
		return null
	}

	return seconds
}

export function normalizeDiscordRouteKey(url: string, method?: string): string {
	const parsedUrl = new URL(url)
	const pathname = parsedUrl.pathname.replace(/^\/api\/v\d+/, '')
	return `${(method ?? 'GET').toUpperCase()} ${normalizeDiscordPath(pathname)}`
}

export class DiscordRateLimitGuard {
	private readonly cooldowns = new Map<string, number>()
	private readonly routeToBucket = new Map<string, string>()
	private store?: DiscordRateLimitStore

	constructor(store?: DiscordRateLimitStore) {
		this.store = store
	}

	configureStore(store?: DiscordRateLimitStore): void {
		this.store = store
	}

	private getRouteStorageKey(routeKey: string): string {
		return `discord-rate-limit:route:${routeKey}`
	}

	private getBucketStorageKey(bucket: string): string {
		return `discord-rate-limit:bucket:${bucket}`
	}

	private getGlobalStorageKey(): string {
		return 'discord-rate-limit:global'
	}

	private static ttlSecondsFromExpiresAt(expiresAt: number): number {
		return Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000))
	}

	private async loadStoredRecord(key: string): Promise<DiscordRateLimitRecord | null> {
		if (!this.store) {
			return null
		}

		try {
			const record = await this.store.get(key)
			if (!record) {
				return null
			}

			if (record.expiresAt <= Date.now()) {
				await this.store.delete?.(key)
				return null
			}

			return record
		} catch (error) {
			console.warn('[DiscordRateLimit] Failed to load persisted cooldown', {
				key,
				error: String(error),
			})
			return null
		}
	}

	private async persistRecord(key: string, record: DiscordRateLimitRecord): Promise<void> {
		if (!this.store) {
			return
		}

		try {
			const ttlSeconds = DiscordRateLimitGuard.ttlSecondsFromExpiresAt(record.expiresAt)
			await this.store.put(key, record, ttlSeconds)
		} catch (error) {
			console.warn('[DiscordRateLimit] Failed to persist cooldown', {
				key,
				error: String(error),
			})
		}
	}

	private hydrateCooldown(routeKey: string, record: DiscordRateLimitRecord): void {
		this.cooldowns.set(routeKey, Math.max(this.cooldowns.get(routeKey) ?? 0, record.expiresAt))
		if (record.bucket) {
			this.routeToBucket.set(routeKey, record.bucket)
			this.cooldowns.set(
				`bucket:${record.bucket}`,
				Math.max(this.cooldowns.get(`bucket:${record.bucket}`) ?? 0, record.expiresAt)
			)
		}
		if (record.global || record.scope === 'global') {
			this.cooldowns.set('global', Math.max(this.cooldowns.get('global') ?? 0, record.expiresAt))
		}
	}

	private async refreshFromStore(routeKey: string): Promise<void> {
		if (!this.store) {
			return
		}

		const [routeRecord, globalRecord] = await Promise.all([
			this.loadStoredRecord(this.getRouteStorageKey(routeKey)),
			this.loadStoredRecord(this.getGlobalStorageKey()),
		])

		if (routeRecord) {
			this.hydrateCooldown(routeKey, routeRecord)
			if (routeRecord.bucket) {
				const bucketRecord = await this.loadStoredRecord(
					this.getBucketStorageKey(routeRecord.bucket)
				)
				if (bucketRecord) {
					this.hydrateCooldown(routeKey, bucketRecord)
				}
			}
		}

		if (globalRecord) {
			this.hydrateCooldown(routeKey, globalRecord)
		}
	}

	reset(): void {
		this.cooldowns.clear()
		this.routeToBucket.clear()
	}

	private getCooldownKey(routeKey: string): string {
		const bucket = this.routeToBucket.get(routeKey)
		return bucket ? `bucket:${bucket}` : routeKey
	}

	private getCooldownExpiry(routeKey: string): number {
		const routeExpiry = this.cooldowns.get(routeKey) ?? 0
		const bucketExpiry = this.cooldowns.get(this.getCooldownKey(routeKey)) ?? 0
		const globalExpiry = this.cooldowns.get('global') ?? 0
		return Math.max(routeExpiry, bucketExpiry, globalExpiry)
	}

	async wait(routeKey: string): Promise<void> {
		if (this.getCooldownExpiry(routeKey) <= Date.now()) {
			await this.refreshFromStore(routeKey)
		}

		const delayMs = this.getDelayMs(routeKey)
		if (delayMs > 0) {
			console.warn('[DiscordRateLimit] Waiting for Discord cooldown', {
				routeKey,
				delayMs,
			})
			await sleep(delayMs)
		}
	}

	getDelayMs(routeKey: string): number {
		const expiry = this.getCooldownExpiry(routeKey)
		return Math.max(0, expiry - Date.now())
	}

	record(routeKey: string, observation: DiscordRateLimitObservation): void {
		const expiresAt = Date.now() + Math.max(0, observation.retryAfterMs ?? 0)
		if (expiresAt <= Date.now()) {
			return
		}

		const record: DiscordRateLimitRecord = {
			bucket: observation.bucket ?? null,
			expiresAt,
			global: observation.global,
			scope: observation.scope ?? null,
			routeKey,
		}

		this.hydrateCooldown(routeKey, record)

		void this.persistRecord(this.getRouteStorageKey(routeKey), record)
		if (observation.bucket) {
			void this.persistRecord(this.getBucketStorageKey(observation.bucket), record)
		}
		if (observation.global || observation.scope === 'global') {
			void this.persistRecord(this.getGlobalStorageKey(), {
				...record,
				global: true,
			})
		}
	}

	async observe(routeKey: string, response: Response): Promise<DiscordRateLimitObservation | null> {
		const bucket = response.headers.get('X-RateLimit-Bucket')
		const scope = response.headers.get('X-RateLimit-Scope')
		const isGlobal =
			response.headers.get('X-RateLimit-Global') === 'true' ||
			scope === 'global'
		const remainingHeader = response.headers.get('X-RateLimit-Remaining')
		const resetAfterHeader = response.headers.get('Retry-After') ?? response.headers.get('X-RateLimit-Reset-After')

		const remaining =
			remainingHeader !== null ? Number.parseInt(remainingHeader, 10) : null
		const resetAfterSeconds = parseRetryAfterSeconds(resetAfterHeader)
		const hasRetryAfterHeader = resetAfterSeconds !== null

		if (bucket) {
			this.routeToBucket.set(routeKey, bucket)
		}

		let bodyGlobal = false
		let bodyRetryAfterSeconds: number | null = null
		if (response.status === 429) {
			try {
				const body = await parseJsonResponse<DiscordRateLimitBody>(response.clone(), {
					context: `Discord rate limit response for ${routeKey}`,
					allowEmpty: true,
				}).catch(() => null)
				bodyRetryAfterSeconds =
					body && typeof body.retry_after === 'number' ? body.retry_after : null
				bodyGlobal = body?.global === true
			} catch (error) {
				console.warn('[DiscordRateLimit] Failed to parse Discord rate limit body', {
					routeKey,
					error: String(error),
				})
			}

			const retryAfterSeconds = bodyRetryAfterSeconds ?? resetAfterSeconds
			const retryAfterMs =
				retryAfterSeconds !== null ? Math.ceil(retryAfterSeconds * 1000) : null
			if (retryAfterMs !== null) {
				this.record(routeKey, {
					bucket,
					global: bodyGlobal || isGlobal,
					remaining,
					resetAfterMs: resetAfterSeconds !== null ? Math.ceil(resetAfterSeconds * 1000) : null,
					retryAfterMs,
					scope,
				})
				return {
					bucket,
					global: bodyGlobal || isGlobal,
					remaining,
					resetAfterMs: resetAfterSeconds !== null ? Math.ceil(resetAfterSeconds * 1000) : null,
					retryAfterMs,
					scope,
				}
			}
		}

		if (remaining === 0 && hasRetryAfterHeader) {
			const retryAfterMs = Math.ceil((resetAfterSeconds ?? 0) * 1000)
			this.record(routeKey, {
				bucket,
				global: isGlobal,
				remaining,
				resetAfterMs: retryAfterMs,
				retryAfterMs,
				scope,
			})
			return {
				bucket,
				global: isGlobal,
				remaining,
				resetAfterMs: retryAfterMs,
				retryAfterMs,
				scope,
			}
		}

		return {
			bucket,
			global: isGlobal,
			remaining,
			resetAfterMs: resetAfterSeconds !== null ? Math.ceil(resetAfterSeconds * 1000) : null,
			retryAfterMs: null,
			scope,
		}
	}
}

export const discordRateLimitGuard = new DiscordRateLimitGuard()
