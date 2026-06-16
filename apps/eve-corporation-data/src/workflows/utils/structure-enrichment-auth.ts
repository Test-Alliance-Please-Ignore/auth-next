const STRUCTURE_ENRICHMENT_SCOPE_401_PATH_MARKERS = [
	'/structures/sovereignty-hubs',
	'/structures/skyhooks',
	'/structures/mercenary-dens',
] as const

function parseEsiErrorMetadata(message: string): Record<string, unknown> | null {
	const marker = ' | metadata='
	const idx = message.lastIndexOf(marker)
	if (idx === -1) return null

	const text = message.slice(idx + marker.length).trim()
	if (!text) return null

	try {
		const parsed = JSON.parse(text)
		return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
	} catch {
		return null
	}
}

/**
 * Temporarily suppress director health degradation for scope-mismatch 401s on
 * the structure-enrichment paths that recently gained new scopes.
 *
 * TODO: once the SSO director scope bundle is fully rolled out, re-enable
 * unhealthy marking for these endpoints so missing scopes are surfaced again.
 */
export function shouldSuppressDirectorUnhealthyOnStructureEnrichmentAuthFailure(
	error: unknown
): boolean {
	if (!(error instanceof Error)) return false

	const metadata = parseEsiErrorMetadata(error.message)
	if (metadata?.status !== 401) return false

	const path = typeof metadata.path === 'string' ? metadata.path : ''
	return STRUCTURE_ENRICHMENT_SCOPE_401_PATH_MARKERS.some((marker) => path.includes(marker))
}
