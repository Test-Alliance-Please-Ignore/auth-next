import { useMemo, useState } from 'react'

import { isTaxDemoModeEnabled, resolveDemoEntityNames } from '@/dev/tax-demo-mode'
import { useCorporationAccess } from '@/features/my-corporations'
import { useTaxCorporations } from '@/hooks/useCorporationTax'

export function useTaxCorporationAccessScope(allowGlobalScope: boolean) {
	const isDemoMode = isTaxDemoModeEnabled()
	const { data: corporationAccess, isLoading: corporationAccessLoading } = useCorporationAccess()
	const { data: taxCorporations = [], isLoading: taxCorporationsLoading } = useTaxCorporations({
		limit: 200,
		enabled: allowGlobalScope,
	})

	const accessibleCorporations = useMemo(() => {
		const merged = new Map<string, { corporationId: string; name: string }>()
		const demoEntityNames = isDemoMode
			? resolveDemoEntityNames(taxCorporations.map((corporation) => corporation.corporationId))
			: {}

		if (!isDemoMode) {
			for (const corporation of corporationAccess?.corporations ?? []) {
				merged.set(corporation.corporationId, {
					corporationId: corporation.corporationId,
					name: corporation.name,
				})
			}
		}

		for (const corporation of taxCorporations) {
			if (!merged.has(corporation.corporationId)) {
				merged.set(corporation.corporationId, {
					corporationId: corporation.corporationId,
					name: demoEntityNames[corporation.corporationId] ?? corporation.corporationId,
				})
			}
		}

		return Array.from(merged.values())
	}, [corporationAccess?.corporations, isDemoMode, taxCorporations])

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
			(!isDemoMode && corporationAccessLoading) || (allowGlobalScope && taxCorporationsLoading),
		accessibleCorporations,
		selectedCorporationId,
		setSelectedCorporationId,
		effectiveCorporationId,
	}
}
