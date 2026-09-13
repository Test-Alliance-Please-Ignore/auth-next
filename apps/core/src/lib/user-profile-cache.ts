import type { UserProfileDTO } from '@repo/core'

const USER_PROFILE_CACHE_TTL_MS = 60_000
const userProfileCache = new Map<string, { value: UserProfileDTO; expiresAt: number }>()
const pendingUserProfiles = new Map<string, Promise<UserProfileDTO>>()

export function getCachedUserProfile(
	userId: string,
	includeDeleted: boolean,
	load: () => Promise<UserProfileDTO>
): Promise<UserProfileDTO> {
	const key = `user:${userId}:deleted:${includeDeleted}`
	const cached = userProfileCache.get(key)
	if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.value)
	const pending = pendingUserProfiles.get(key)
	if (pending) return pending
	const request = load()
		.then((value) => {
			userProfileCache.set(key, { value, expiresAt: Date.now() + USER_PROFILE_CACHE_TTL_MS })
			return value
		})
		.finally(() => pendingUserProfiles.delete(key))
	pendingUserProfiles.set(key, request)
	return request
}

export function clearUserProfileCache(userId: string): void {
	userProfileCache.delete(`user:${userId}:deleted:false`)
	userProfileCache.delete(`user:${userId}:deleted:true`)
}
