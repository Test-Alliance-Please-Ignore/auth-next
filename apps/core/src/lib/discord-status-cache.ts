import type { DiscordStatus } from './discord-helpers'

const DISCORD_STATUS_CACHE_TTL_MS = 60_000
const discordStatusCache = new Map<string, { value: DiscordStatus | null; expiresAt: number }>()
const pendingDiscordStatus = new Map<string, Promise<DiscordStatus | null>>()

export function getCachedDiscordStatus(
	userId: string,
	load: () => Promise<DiscordStatus | null>
): Promise<DiscordStatus | null> {
	const key = `user:${userId}`
	const cached = discordStatusCache.get(key)
	if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.value)
	const pending = pendingDiscordStatus.get(key)
	if (pending) return pending
	const request = load()
		.then((value) => {
			discordStatusCache.set(key, { value, expiresAt: Date.now() + DISCORD_STATUS_CACHE_TTL_MS })
			return value
		})
		.finally(() => pendingDiscordStatus.delete(key))
	pendingDiscordStatus.set(key, request)
	return request
}

export function clearDiscordStatusCache(userId: string): void {
	discordStatusCache.delete(`user:${userId}`)
}
