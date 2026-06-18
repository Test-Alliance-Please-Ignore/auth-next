import { Hono } from 'hono'

import { getStub } from '@repo/do-utils'
import { MUMBLE_FEATURE_FLAG_KEY } from '@repo/features'

import type { Features } from '@repo/features'
import type { App } from '../context'

const app = new Hono<App>()

export const SRP_FEATURE_FLAG_KEY = 'srp.enabled'
export const PRICING_INGEST_FLAG_KEY = 'markets.pricing.ingest.enabled'
export { MUMBLE_FEATURE_FLAG_KEY }

const UI_FLAGS = [SRP_FEATURE_FLAG_KEY, MUMBLE_FEATURE_FLAG_KEY] as const

export async function resolveFlag(
	featuresNamespace: DurableObjectNamespace | undefined,
	key: string,
	defaultValue = false
): Promise<boolean> {
	if (!featuresNamespace) return defaultValue
	try {
		const stub = getStub<Features>(featuresNamespace, 'default')
		const value = await stub.checkFlag(key)
		return value === null ? defaultValue : value === true
	} catch {
		return defaultValue
	}
}

/**
 * GET /api/flags
 * Returns boolean values for all UI-facing feature flags.
 * Defaults to false (disabled) when a flag is not registered.
 */
app.get('/', async (c) => {
	const results = await Promise.all(
		UI_FLAGS.map(async (key) => [key, await resolveFlag(c.env.FEATURES, key)] as const)
	)
	return c.json(Object.fromEntries(results) as Record<(typeof UI_FLAGS)[number], boolean>)
})

export default app
