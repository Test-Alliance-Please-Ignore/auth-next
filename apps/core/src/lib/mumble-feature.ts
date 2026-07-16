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

/**
 * Why this exists ALONGSIDE the lenient check rather than replacing it.
 *
 * `isMumbleFeatureEnabled` collapses three genuinely different states —
 * "binding missing", "FEATURES DO unreachable", "flag deliberately off" — into a
 * single `false`. For a background side effect that is correct and must not
 * change: failing closed is the safe default and the caller has nothing useful
 * to do with the distinction anyway.
 *
 * For an operator staring at an audit run, that same collapse destroys the
 * signal. "Mumble enforcement would no-op" and "we could not tell whether Mumble
 * enforcement would no-op" demand opposite responses, and the lenient form
 * reports them identically.
 */
export type MumbleFeatureState =
	/** The flag is registered and true. Enforcement would act. */
	| { enabled: true; state: 'enabled' }
	/** The flag is reachable and is off/unset. Enforcement would silently no-op. */
	| { enabled: false; state: 'flag_off'; message: string }
	/** No FEATURES binding on this worker. A deploy/config fault, not a flag. */
	| { enabled: false; state: 'binding_missing'; message: string }
	/** The binding exists but the DO could not be reached. State is UNKNOWN. */
	| { enabled: false; state: 'unreachable'; message: string }

/**
 * Resolve the Mumble feature flag, preserving the distinction between "off",
 * "misconfigured" and "unknown".
 *
 * READ-ONLY USE ONLY (increment 3): the result is *reported* on the audit run so
 * an operator can see, before committing to anything, that enforcement would
 * silently no-op. It must never gate a mutation — the mutating path has its own
 * fail-closed check, and gating on `unreachable` here would let a transient DO
 * blip read as "feature off".
 *
 * Deliberately does NOT throw: a scan whose flag lookup failed is still a valid,
 * useful scan. The failure is data on the run, not an abort.
 */
export async function isMumbleFeatureEnabledStrict(
	env: Pick<Env, 'FEATURES'>
): Promise<MumbleFeatureState> {
	if (!env.FEATURES) {
		return {
			enabled: false,
			state: 'binding_missing',
			message:
				'The FEATURES Durable Object binding is missing from this worker, so the Mumble feature flag could not be read. ' +
				'This is a deployment/configuration fault rather than a feature toggle: add the FEATURES binding to wrangler.jsonc and redeploy. ' +
				'Mumble enforcement would silently do nothing until this is fixed.',
		}
	}

	let value: unknown
	try {
		const stub = getStub<Features>(env.FEATURES, 'default')
		value = await stub.checkFlag(MUMBLE_FEATURE_FLAG_KEY)
	} catch (error) {
		return {
			enabled: false,
			state: 'unreachable',
			message:
				`The FEATURES Durable Object could not be reached, so the Mumble feature flag state is UNKNOWN (not "off"): ${
					error instanceof Error ? error.message : String(error)
				}. ` +
				'Treat Mumble enforcement as unpredictable until a scan reports a definite flag state.',
		}
	}

	// checkFlag returns null for an unregistered flag and the raw value otherwise,
	// so only an exact `true` means enabled. Anything else is off-or-unset —
	// which is reachable-and-negative, distinct from the two cases above.
	if (value === true) {
		return { enabled: true, state: 'enabled' }
	}

	return {
		enabled: false,
		state: 'flag_off',
		message:
			`The Mumble feature flag ("${MUMBLE_FEATURE_FLAG_KEY}") is reachable but not enabled (value: ${JSON.stringify(value) ?? 'undefined'}). ` +
			'This scan is unaffected — it is read-only — but Mumble enforcement would silently do nothing while the flag is off. ' +
			'Enable the flag before relying on Mumble revocation.',
	}
}
