export function getSnapshotDeleteCount(totalSnapshots: number, maxSnapshots: number): number {
	if (maxSnapshots <= 0 || totalSnapshots <= maxSnapshots) {
		return 0
	}

	return totalSnapshots - maxSnapshots
}
