import { TimeCache } from '@repo/hono-helpers'

import type { Hr } from '@repo/hr'

const USER_BLOCKLIST_CACHE_TTL_MS = 5_000

const userBlocklistCache = new TimeCache<boolean>(USER_BLOCKLIST_CACHE_TTL_MS)

export async function getCachedUserBlocklistStatus(hr: Hr, userId: string): Promise<boolean> {
	return userBlocklistCache.getOrSet(`user:${userId}`, () => hr.isUserBlacklisted(userId))
}

export function clearCachedUserBlocklistStatus(userId: string): void {
	userBlocklistCache.delete(`user:${userId}`)
}
