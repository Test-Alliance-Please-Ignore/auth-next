import type { EveCorporationSyncDataType } from '@repo/eve-corporation-data'

/**
 * Build a predicate that returns whether a data type should be synced
 */
export function createShouldSyncPredicate(dataTypes?: EveCorporationSyncDataType[]) {
	const hasFilters = Array.isArray(dataTypes) && dataTypes.length > 0

	if (!hasFilters) {
		return () => true
	}

	const requestedTypes = new Set<EveCorporationSyncDataType>(dataTypes)
	return (type: EveCorporationSyncDataType) => requestedTypes.has(type)
}

