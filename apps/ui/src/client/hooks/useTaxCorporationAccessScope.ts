import { useMemo, useState } from 'react'

import { useCorporationAccess } from '@/features/my-corporations'
import { useTaxCorporations } from '@/hooks/useCorporationTax'
import { useEntityNames } from '@/hooks/useEntityNames'

export function useTaxCorporationAccessScope(allowGlobalScope: boolean) {
	const { data: corporationAccess, isLoading: corporationAccessLoading } = useCorporationAccess()
	const { data: taxCorporations = [], isLoading: taxCorporationsLoading } = useTaxCorporations({
		limit: 200,
		enabled: allowGlobalScope,
	})
	const unresolvedCorporationIds = useMemo(() => {
		const accessIdSet = new Set(
			(corporationAccess?.corporations ?? []).map((corp) => corp.corporationId)
		)
		return taxCorporations
			.map((corporation) => corporation.corporationId)
			.filter((corporationId) => !accessIdSet.has(corporationId))
	}, [corporationAccess?.corporations, taxCorporations])
	const { data: resolvedEntityNames = {}, isLoading: entityNamesLoading } = useEntityNames(
		unresolvedCorporationIds,
		{
			enabled: unresolvedCorporationIds.length > 0,
		}
	)

	const accessibleCorporations = useMemo(() => {
		const merged = new Map<string, { corporationId: string; name: string }>()

		for (const corporation of corporationAccess?.corporations ?? []) {
			merged.set(corporation.corporationId, {
				corporationId: corporation.corporationId,
				name: corporation.name,
			})
		}

		for (const corporation of taxCorporations) {
			if (!merged.has(corporation.corporationId)) {
				merged.set(corporation.corporationId, {
					corporationId: corporation.corporationId,
					name: resolvedEntityNames[corporation.corporationId] ?? corporation.corporationId,
				})
			}
		}

		return Array.from(merged.values())
	}, [corporationAccess?.corporations, resolvedEntityNames, taxCorporations])

	const [selectedCorporationId, setSelectedCorporationId] = useState<string | undefined>(undefined)

	const effectiveCorporationId = useMemo(() => {
		if (selectedCorporationId) {
			return selectedCorporationId
		}
		if (!allowGlobalScope && accessibleCorporations.length > 0) {
			return accessibleCorporations[0]?.corporationId
		}
		return undefined
	}, [selectedCorporationId, allowGlobalScope, accessibleCorporations])

	return {
		corporationAccess,
		corporationAccessLoading:
			corporationAccessLoading ||
			(allowGlobalScope && (taxCorporationsLoading || entityNamesLoading)),
		accessibleCorporations,
		selectedCorporationId,
		setSelectedCorporationId,
		effectiveCorporationId,
	}
}
