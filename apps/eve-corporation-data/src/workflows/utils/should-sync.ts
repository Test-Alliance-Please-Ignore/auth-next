import type { EveCorporationSyncDataType } from '@repo/eve-corporation-data'

/**
 * Build a predicate that returns whether a data type should be synced
 */
export function createShouldSyncPredicate(
	dataTypes?: EveCorporationSyncDataType[],
	options?: { disabledDataTypes?: EveCorporationSyncDataType[] }
) {
	const hasFilters = Array.isArray(dataTypes) && dataTypes.length > 0
	const disabledTypes = new Set<EveCorporationSyncDataType>(options?.disabledDataTypes ?? [])

	if (!hasFilters) {
		return (type: EveCorporationSyncDataType) => !disabledTypes.has(type)
	}

	const requestedTypes = new Set<EveCorporationSyncDataType>(dataTypes)
	return (type: EveCorporationSyncDataType) =>
		requestedTypes.has(type) && !disabledTypes.has(type)
}
