import type { EveCorporationSyncDataType } from '@repo/eve-corporation-data'

export interface SyncedDataTracker {
	get(): EveCorporationSyncDataType[]
	add(type: EveCorporationSyncDataType): EveCorporationSyncDataType[]
}

/**
 * Helper to track synced data types across workflow steps in a serializable way
 */
export function createSyncedDataTracker(): SyncedDataTracker {
	let syncedDataTypes: EveCorporationSyncDataType[] = []

	return {
		get: () => syncedDataTypes,
		add: (type) => {
			syncedDataTypes = [...syncedDataTypes, type]
			return syncedDataTypes
		},
	}
}

