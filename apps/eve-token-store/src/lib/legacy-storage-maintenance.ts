/**
 * TEMPORARY ONE-TIME MAINTENANCE CONTROLS.
 *
 * Remove this file, the maintenance route, and the matching RPC methods after
 * the production legacy-cache purge has been verified. Keep the allowlist
 * narrow: the current access-token cache and OAuth coordination keys are
 * intentionally not part of this operation.
 */

export const LEGACY_CACHE_PURGE_CONFIRMATION = 'PURGE_LEGACY_ESI_CACHE'

export function isLegacyCachePurgeConfirmed(value: unknown): boolean {
	return value === LEGACY_CACHE_PURGE_CONFIRMATION
}

export function hasMaintenanceSecret(
	configuredSecret: string | undefined,
	providedSecret: string | undefined
): boolean {
	if (!configuredSecret || !providedSecret) {
		return false
	}

	const configuredBytes = new TextEncoder().encode(configuredSecret)
	const providedBytes = new TextEncoder().encode(providedSecret)
	const length = Math.max(configuredBytes.length, providedBytes.length)
	let difference = configuredBytes.length ^ providedBytes.length

	for (let index = 0; index < length; index += 1) {
		difference |= (configuredBytes[index] ?? 0) ^ (providedBytes[index] ?? 0)
	}

	return difference === 0
}
