const TAX_VIEWER_SCOPED_URN_PATTERN = /^urn:corps:([0-9]+):tax:viewer$/

export function extractCorporationIdFromTaxViewerScopedUrn(urn: string): string | null {
	const match = TAX_VIEWER_SCOPED_URN_PATTERN.exec(urn)
	return match?.[1] ?? null
}

export function getScopedViewerCorporationIdsFromUrns(urns: string[]): Set<string> {
	const corporationIds = new Set<string>()
	for (const urn of urns) {
		const corporationId = extractCorporationIdFromTaxViewerScopedUrn(urn)
		if (corporationId) {
			corporationIds.add(corporationId)
		}
	}
	return corporationIds
}
