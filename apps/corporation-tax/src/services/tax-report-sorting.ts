export type SortDirection = 'asc' | 'desc'

export function toSortDirection(
	input: 'asc' | 'desc' | undefined,
	defaultDirection: SortDirection
): SortDirection {
	return input === 'asc' || input === 'desc' ? input : defaultDirection
}

export function compareBigInts(a: bigint, b: bigint, direction: SortDirection): number {
	if (a === b) {
		return 0
	}
	const order = a > b ? 1 : -1
	return direction === 'asc' ? order : -order
}

export function compareNumbers(a: number, b: number, direction: SortDirection): number {
	if (a === b) {
		return 0
	}
	const order = a > b ? 1 : -1
	return direction === 'asc' ? order : -order
}

export function compareStrings(a: string, b: string, direction: SortDirection): number {
	const order = a.localeCompare(b)
	return direction === 'asc' ? order : -order
}

export function compareDatesNullable(
	a: Date | null,
	b: Date | null,
	direction: SortDirection
): number {
	if (a === b) {
		return 0
	}
	if (a === null) {
		return 1
	}
	if (b === null) {
		return -1
	}
	return compareNumbers(a.getTime(), b.getTime(), direction)
}
