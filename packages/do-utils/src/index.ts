/**
 * Get a typed Durable Object stub
 *
 * This helper provides type-safe access to Durable Object stubs when calling
 * across workers using shared interface packages.
 *
 * @example
 * ```ts
 * import type { UserTokenStore } from '@repo/user-token-store'
 * import { getStub } from '@repo/do-utils'
 *
 * const stub = getStub<UserTokenStore>(c.env.USER_TOKEN_STORE, 'global')
 * const token = await stub.getAccessToken(characterId)
 * ```
 */
export function getStub<T>(
	namespace: DurableObjectNamespace,
	id: string | DurableObjectId
): DurableObjectStub & T {
	const durableObjectId = typeof id === 'string' ? namespace.idFromName(id) : id
	return namespace.get(durableObjectId) as DurableObjectStub & T
}
