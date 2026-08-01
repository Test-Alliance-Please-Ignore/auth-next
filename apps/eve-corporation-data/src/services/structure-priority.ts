export type SyncPriorityLike = {
	structureId: string
	lastAttemptedSyncAt: Date | null
	lastSyncedAt: Date | null
}

export function buildPriorityQueuedEntries<
	T extends { id: string | number },
	P extends SyncPriorityLike,
>(
	entries: readonly T[],
	newStructureIds: readonly string[] = [],
	syncPriorities: readonly P[] = [],
	options: {
		pruneCandidateIds: readonly string[]
	}
): {
	entries: Array<{ index: number; entry: T; priority: P | null }>
	pruneCandidateIds: string[]
} {
	const newStructureIdSet = new Set(newStructureIds.map((structureId) => String(structureId)))
	const priorityByStructureId = new Map(
		syncPriorities.map((priority) => [priority.structureId, priority] as const)
	)
	const mappedEntries = entries.map((entry, index) => ({
		entry,
		index,
		priority: priorityByStructureId.get(String(entry.id)) ?? null,
	}))

	const newEntries = mappedEntries.filter((entry) => newStructureIdSet.has(String(entry.entry.id)))
	const prioritizedEntries = mappedEntries
		.filter((entry) => entry.priority !== null && !newStructureIdSet.has(String(entry.entry.id)))
		.sort((a, b) => {
			const aPriority = a.priority!
			const bPriority = b.priority!
			const aSynced = aPriority.lastSyncedAt?.getTime() ?? Number.NEGATIVE_INFINITY
			const bSynced = bPriority.lastSyncedAt?.getTime() ?? Number.NEGATIVE_INFINITY
			if (aSynced !== bSynced) return aSynced - bSynced

			const aAttempted = aPriority.lastAttemptedSyncAt?.getTime() ?? Number.NEGATIVE_INFINITY
			const bAttempted = bPriority.lastAttemptedSyncAt?.getTime() ?? Number.NEGATIVE_INFINITY
			if (aAttempted !== bAttempted) return aAttempted - bAttempted

			return a.index - b.index
		})

	const pruneCandidateIds = [
		...new Set(options.pruneCandidateIds.map((structureId) => String(structureId))),
	]

	return {
		entries: [...newEntries, ...prioritizedEntries],
		pruneCandidateIds,
	}
}

export function buildPriorityOrderedEntries<
	T extends { id: string | number },
	P extends SyncPriorityLike,
>(
	entries: readonly T[],
	syncPriorities: readonly P[] = [],
	options: {
		knownStructureIds?: readonly string[]
	} = {}
): Array<{ index: number; entry: T; priority: P | null }> {
	const liveStructureIds = new Set(entries.map((entry) => String(entry.id)))
	const knownStructureIds = options.knownStructureIds
		? new Set(options.knownStructureIds.map((structureId) => String(structureId)))
		: null
	const livePriorities = syncPriorities.filter(
		(priority) =>
			liveStructureIds.has(priority.structureId) &&
			(knownStructureIds === null || knownStructureIds.has(priority.structureId))
	)
	const priorityByStructureId = new Map(
		livePriorities.map((priority) => [priority.structureId, priority] as const)
	)
	const mappedEntries = entries.map((entry, index) => ({
		entry,
		index,
		priority: priorityByStructureId.get(String(entry.id)) ?? null,
	}))

	const newEntries = mappedEntries.filter((entry) => {
		if (entry.priority !== null) return false
		if (knownStructureIds === null) return true
		return !knownStructureIds.has(String(entry.entry.id))
	})
	const prioritizedEntries = mappedEntries
		.filter((entry) => entry.priority !== null)
		.sort((a, b) => {
			const aPriority = a.priority!
			const bPriority = b.priority!
			const aSynced = aPriority.lastSyncedAt?.getTime() ?? Number.NEGATIVE_INFINITY
			const bSynced = bPriority.lastSyncedAt?.getTime() ?? Number.NEGATIVE_INFINITY
			if (aSynced !== bSynced) return aSynced - bSynced

			const aAttempted = aPriority.lastAttemptedSyncAt?.getTime() ?? Number.NEGATIVE_INFINITY
			const bAttempted = bPriority.lastAttemptedSyncAt?.getTime() ?? Number.NEGATIVE_INFINITY
			if (aAttempted !== bAttempted) return aAttempted - bAttempted

			return a.index - b.index
		})

	return [...newEntries, ...prioritizedEntries]
}
