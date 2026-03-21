import type { MRT_SortingState } from 'mantine-react-table'

export type SortDirection = 'asc' | 'desc'

export function toStartOfDayIso(dateText: string): string {
	return new Date(`${dateText}T00:00:00.000Z`).toISOString()
}

export function toEndOfDayIso(dateText: string): string {
	return new Date(`${dateText}T23:59:59.999Z`).toISOString()
}

export function parseTaxAmount(value: string | number | null | undefined): number {
	if (value === null || value === undefined) {
		return 0
	}
	if (typeof value === 'number') {
		return Number.isFinite(value) ? value : 0
	}
	const normalized = value.trim().replace(/[^0-9+.\-]/g, '')
	const parsed = Number(normalized)
	return Number.isFinite(parsed) ? parsed : 0
}

export function toLinePoints(
	values: number[],
	maxValue: number,
	width: number,
	height: number
): string {
	if (values.length === 0) {
		return ''
	}
	if (values.length === 1) {
		const y = height - (values[0]! / maxValue) * height
		return `0,${Math.max(0, Math.min(height, y))}`
	}

	const step = width / (values.length - 1)
	return values
		.map((value, index) => {
			const ratio = maxValue === 0 ? 0 : value / maxValue
			const y = height - ratio * height
			return `${index * step},${Math.max(0, Math.min(height, y))}`
		})
		.join(' ')
}

export function downloadBase64File(
	fileName: string,
	contentType: string,
	contentBase64: string
): void {
	const binary = atob(contentBase64)
	const bytes = new Uint8Array(binary.length)
	for (let i = 0; i < binary.length; i += 1) {
		bytes[i] = binary.charCodeAt(i)
	}
	const blob = new Blob([bytes], { type: contentType })
	const url = URL.createObjectURL(blob)
	const anchor = document.createElement('a')
	anchor.href = url
	anchor.download = fileName
	anchor.click()
	URL.revokeObjectURL(url)
}

export function toSorting(sortBy?: string, sortDir?: SortDirection): MRT_SortingState {
	return sortBy ? [{ id: sortBy, desc: sortDir === 'desc' }] : []
}

export function applySorting(
	sorting: MRT_SortingState,
	defaultSortBy: string,
	defaultSortDir: SortDirection,
	setSortBy: (value: string) => void,
	setSortDir: (value: SortDirection) => void,
	resetPage?: () => void
) {
	const first = sorting[0]
	if (!first) {
		setSortBy(defaultSortBy)
		setSortDir(defaultSortDir)
		resetPage?.()
		return
	}

	setSortBy(first.id)
	setSortDir(first.desc ? 'desc' : 'asc')
	resetPage?.()
}

export function toSearchOptions<TValue extends string>(
	options: Array<{ value: TValue; label: string }>
) {
	return options.map((option) => ({
		id: option.value,
		value: option.value,
		label: option.label,
	}))
}
