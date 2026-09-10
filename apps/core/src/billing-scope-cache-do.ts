import { DurableObject } from 'cloudflare:workers'

import type { BillListScopeEntity } from '@repo/bills'
import type { Env } from './context'

export interface UserBillScope {
	characterIds: string[]
	corporationIds: string[]
	groupIds: string[]
	partyEntities: BillListScopeEntity[]
}

export interface StoredBillingScope {
	scope: UserBillScope
	expiresAt: number
	version: string
}

export interface BillingScopeCache {
	getScope(cacheId: string, userId: string): Promise<StoredBillingScope | null>
	getScopeVersion(cacheId: string, userId: string): Promise<string>
	putScope(
		cacheId: string,
		userId: string,
		scope: UserBillScope,
		expiresAt: number,
		version: string
	): Promise<void>
	clearScope(cacheId: string, userId: string): Promise<void>
	clearAllScopes(cacheId: string): Promise<void>
}

const STORAGE_PREFIX = 'billing-scope:entry:'
const GLOBAL_REVISION_KEY = 'billing-scope:revision:global'
const USER_REVISION_PREFIX = 'billing-scope:revision:user:'

/** Durable, cross-isolate storage for the derived billing scope projection. */
export class BillingScopeCacheDO extends DurableObject<Env> implements BillingScopeCache {
	private key(userId: string): string {
		return `${STORAGE_PREFIX}${userId}`
	}

	private userRevisionKey(userId: string): string {
		return `${USER_REVISION_PREFIX}${userId}`
	}

	async getScopeVersion(_cacheId: string, userId: string): Promise<string> {
		const [globalRevision, userRevision] = await Promise.all([
			this.ctx.storage.get<number>(GLOBAL_REVISION_KEY),
			this.ctx.storage.get<number>(this.userRevisionKey(userId)),
		])
		return `${globalRevision ?? 0}:${userRevision ?? 0}`
	}

	async getScope(_cacheId: string, userId: string): Promise<StoredBillingScope | null> {
		const key = this.key(userId)
		let cached: StoredBillingScope | undefined
		await this.ctx.storage.transaction(async (transaction) => {
			const candidate = await transaction.get<StoredBillingScope>(key)
			const [globalRevision, userRevision] = await Promise.all([
				transaction.get<number>(GLOBAL_REVISION_KEY),
				transaction.get<number>(this.userRevisionKey(userId)),
			])
			const version = `${globalRevision ?? 0}:${userRevision ?? 0}`
			if (candidate && candidate.expiresAt > Date.now() && candidate.version === version) {
				cached = candidate
				return
			}
			if (candidate) await transaction.delete(key)
		})
		return cached ?? null
	}

	async putScope(
		_cacheId: string,
		userId: string,
		scope: UserBillScope,
		expiresAt: number,
		version: string
	): Promise<void> {
		await this.ctx.storage.transaction(async (transaction) => {
			const [globalRevision, userRevision] = await Promise.all([
				transaction.get<number>(GLOBAL_REVISION_KEY),
				transaction.get<number>(this.userRevisionKey(userId)),
			])
			if (`${globalRevision ?? 0}:${userRevision ?? 0}` !== version) return
			await transaction.put(this.key(userId), { scope, expiresAt, version })
		})
		const existingAlarm = await this.ctx.storage.getAlarm()
		if (existingAlarm === null || existingAlarm > expiresAt) {
			await this.ctx.storage.setAlarm(expiresAt)
		}
	}

	async clearScope(_cacheId: string, userId: string): Promise<void> {
		await this.ctx.storage.transaction(async (transaction) => {
			const revision = (await transaction.get<number>(this.userRevisionKey(userId))) ?? 0
			await transaction.put(this.userRevisionKey(userId), revision + 1)
			await transaction.delete(this.key(userId))
		})
	}

	async clearAllScopes(_cacheId: string): Promise<void> {
		// Bump the revision first so stale writers are rejected even while the
		// subsequent storage-wide cleanup is in progress.
		let nextRevision = 1
		await this.ctx.storage.transaction(async (transaction) => {
			const revision = (await transaction.get<number>(GLOBAL_REVISION_KEY)) ?? 0
			nextRevision = revision + 1
			await transaction.put(GLOBAL_REVISION_KEY, nextRevision)
		})
		await this.ctx.storage.deleteAll()
		await this.ctx.storage.put(GLOBAL_REVISION_KEY, nextRevision)
		await this.ctx.storage.deleteAlarm()
	}

	async alarm(): Promise<void> {
		const now = Date.now()
		const expiredKeys: string[] = []
		let nextExpiry: number | undefined
		const entries = await this.ctx.storage.list<StoredBillingScope>({ prefix: STORAGE_PREFIX })

		for (const [key, entry] of entries) {
			if (entry.expiresAt <= now) {
				expiredKeys.push(key)
				continue
			}
			if (nextExpiry === undefined || entry.expiresAt < nextExpiry) {
				nextExpiry = entry.expiresAt
			}
		}

		if (expiredKeys.length > 0) {
			await this.ctx.storage.delete(expiredKeys)
		}
		if (nextExpiry !== undefined) {
			await this.ctx.storage.setAlarm(nextExpiry)
		}
	}
}
