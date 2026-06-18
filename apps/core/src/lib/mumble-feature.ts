import { getStub } from '@repo/do-utils'
import { MUMBLE_FEATURE_FLAG_KEY } from '@repo/features'

import type { Features } from '@repo/features'
import type { Env } from '../context'

/**
 * Resolve whether the Mumble feature is enabled.
 *
 * Defaults to false on missing bindings or RPC errors so background side
 * effects can fail closed without interrupting the caller.
 */
export async function isMumbleFeatureEnabled(env: Pick<Env, 'FEATURES'>): Promise<boolean> {
	if (!env.FEATURES) return false

	try {
		const stub = getStub<Features>(env.FEATURES, 'default')
		const value = await stub.checkFlag(MUMBLE_FEATURE_FLAG_KEY)
		return value === true
	} catch {
		return false
	}
}
