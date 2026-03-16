import { useState } from 'react'

import { useLocationSearch } from '@/hooks/useLocationSearch'

import { Badge } from './badge'
import { SearchSelect } from './search-select'
import { Label } from './label'

import type { EsiLocationSearchResult } from '@/lib/esi-api'

interface LocationSearchProps {
	label: string
	value: EsiLocationSearchResult | null
	onChange: (location: EsiLocationSearchResult | null) => void
	placeholder?: string
	required?: boolean
	error?: string
}

export function LocationSearch({
	label,
	value,
	onChange,
	placeholder = 'Search for a system or station...',
	required = false,
	error,
}: LocationSearchProps) {
	const inputId = `location-search-${label}`
	const [query, setQuery] = useState('')
	const [hasInteracted, setHasInteracted] = useState(false)

	const { data: results = [], isLoading } = useLocationSearch(query, hasInteracted)

	const handleSelect = (location: EsiLocationSearchResult) => {
		onChange(location)
		setQuery('')
	}

	const handleClear = () => {
		onChange(null)
		setQuery('')
	}

	const getTypeBadgeVariant = (type: string) => {
		switch (type) {
			case 'system':
				return 'default'
			case 'station':
				return 'secondary'
			case 'structure':
				return 'outline'
			default:
				return 'default'
		}
	}

	return (
		<div className="space-y-2">
			<Label htmlFor={inputId}>
				{label}
				{required && <span className="text-destructive ml-1">*</span>}
			</Label>

			{value ? (
				<div className="flex items-center gap-2 p-3 rounded-md border border-input bg-muted/50">
					<div className="flex-1">
						<div className="font-medium">{value.name}</div>
						<div className="text-sm text-muted-foreground">
							{value.systemName} ({value.regionName})
						</div>
					</div>
					<Badge variant={getTypeBadgeVariant(value.type)}>{value.type}</Badge>
					<button
						type="button"
						onClick={handleClear}
						className="text-muted-foreground hover:text-foreground"
					>
						×
					</button>
				</div>
			) : (
				<SearchSelect
					inputId={inputId}
					value={query}
					onValueChange={(nextQuery) => {
						setQuery(nextQuery)
						setHasInteracted(true)
					}}
					options={results.map((result) => ({
						id: result.id,
						value: result.name,
						label: result.name,
						description: `${result.systemName} (${result.regionName})`,
						result,
					}))}
					onSelect={(option) => handleSelect(option.result)}
					filterMode="server"
					minQueryLength={2}
					placeholder={placeholder}
					loading={query.length >= 2 && isLoading}
					inputClassName={error ? 'border-destructive' : ''}
					minCharsText="Type at least 2 characters"
					loadingText="Searching..."
					emptyText="No locations found"
					getSearchText={(option) =>
						`${option.label} ${option.description ?? ''} ${option.result.type}`
					}
					renderOption={(option) => (
						<div className="flex w-full items-center justify-between gap-2">
							<div className="min-w-0 flex-1">
								<div className="truncate font-medium">{option.label}</div>
								<div className="truncate text-xs text-muted-foreground">{option.description}</div>
							</div>
							<Badge variant={getTypeBadgeVariant(option.result.type)} className="shrink-0">
								{option.result.type}
							</Badge>
						</div>
					)}
				/>
			)}

			{error && <p className="text-sm text-destructive">{error}</p>}
		</div>
	)
}
