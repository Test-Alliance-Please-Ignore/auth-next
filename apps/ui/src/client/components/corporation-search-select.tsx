import { useCallback } from 'react'

import { Select } from '@/components/ui/select'
import { api } from '@/lib/api'

import type { SelectOption } from '@/components/ui/select'

type CorporationSearchRow = {
	corporationId: string
	name: string | null
	ticker?: string | null
}

export interface CorporationSearchSelectProps {
	value: string
	label?: string | null
	query?: string
	defaultQuery?: string
	onQueryChange?: (query: string) => void
	placeholder?: string
	excludeCorporationIds?: Set<string>
	disabled?: boolean
	searchCorporations?: (query: string) => Promise<CorporationSearchRow[]>
	minQueryLength?: number
	debounceMs?: number
	queryHintText?: string
	loadingText?: string
	emptyText?: string
	onValueChange: (corporationId: string, corporationName: string) => void
}

function formatCorporationLabel(corporation: CorporationSearchRow): string {
	return corporation.name ?? corporation.corporationId
}

export function CorporationSearchSelect({
	value,
	label,
	query,
	defaultQuery,
	onQueryChange,
	placeholder = 'Select corporation',
	excludeCorporationIds,
	disabled = false,
	searchCorporations = api.searchManagedCorporations.bind(api),
	minQueryLength = 2,
	debounceMs = 0,
	queryHintText = 'Type at least 2 characters',
	loadingText = 'Searching corporations...',
	emptyText = 'No matching corporations',
	onValueChange,
}: CorporationSearchSelectProps) {
	const searchDelegate = useCallback(
		async (query: string): Promise<SelectOption[]> => {
			const rows = await searchCorporations(query)
			return rows
				.filter((row) => !excludeCorporationIds?.has(row.corporationId) || row.corporationId === value)
				.map((row) => ({
					value: row.corporationId,
					label: formatCorporationLabel(row),
					description: row.ticker ?? undefined,
				}))
		},
		[excludeCorporationIds, searchCorporations, value]
	)

	return (
		<Select
			value={value}
			query={query}
			defaultQuery={defaultQuery}
			onQueryChange={onQueryChange}
			onValueChange={(nextValue, option) => {
				if (!option) return
				onValueChange(nextValue, option.label)
			}}
			options={value ? [{ value, label: label ?? value }] : []}
			searchable
			searchDelegate={searchDelegate}
			placeholder={placeholder}
			minQueryLength={minQueryLength}
			debounceMs={debounceMs}
			queryHintText={queryHintText}
			loadingText={loadingText}
			emptyText={emptyText}
			disabled={disabled}
		/>
	)
}
