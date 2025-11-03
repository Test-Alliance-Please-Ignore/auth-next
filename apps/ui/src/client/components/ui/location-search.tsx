import { useEffect, useRef, useState } from 'react'

import { useLocationSearch } from '@/hooks/useLocationSearch'

import { Badge } from './badge'
import { Input } from './input'
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
	const [query, setQuery] = useState('')
	const [isOpen, setIsOpen] = useState(false)
	const [selectedIndex, setSelectedIndex] = useState(-1)
	const dropdownRef = useRef<HTMLDivElement>(null)
	const inputRef = useRef<HTMLInputElement>(null)

	const { data: results = [], isLoading } = useLocationSearch(query, isOpen)

	// Close dropdown when clicking outside
	useEffect(() => {
		function handleClickOutside(event: MouseEvent) {
			if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
				setIsOpen(false)
			}
		}

		document.addEventListener('mousedown', handleClickOutside)
		return () => document.removeEventListener('mousedown', handleClickOutside)
	}, [])

	// Reset selected index when results change
	useEffect(() => {
		setSelectedIndex(-1)
	}, [results])

	const handleSelect = (location: EsiLocationSearchResult) => {
		onChange(location)
		setQuery('')
		setIsOpen(false)
	}

	const handleClear = () => {
		onChange(null)
		setQuery('')
		setIsOpen(false)
		inputRef.current?.focus()
	}

	const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if (!isOpen || results.length === 0) {
			if (e.key === 'ArrowDown') {
				setIsOpen(true)
			}
			return
		}

		switch (e.key) {
			case 'ArrowDown':
				e.preventDefault()
				setSelectedIndex((prev) => (prev < results.length - 1 ? prev + 1 : prev))
				break
			case 'ArrowUp':
				e.preventDefault()
				setSelectedIndex((prev) => (prev > 0 ? prev - 1 : 0))
				break
			case 'Enter':
				e.preventDefault()
				if (selectedIndex >= 0 && selectedIndex < results.length) {
					handleSelect(results[selectedIndex])
				}
				break
			case 'Escape':
				e.preventDefault()
				setIsOpen(false)
				setQuery('')
				break
		}
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
		<div className="space-y-2" ref={dropdownRef}>
			<Label htmlFor={`location-search-${label}`}>
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
				<div className="relative">
					<Input
						ref={inputRef}
						id={`location-search-${label}`}
						type="text"
						value={query}
						onChange={(e) => {
							setQuery(e.target.value)
							setIsOpen(true)
						}}
						onFocus={() => setIsOpen(true)}
						onKeyDown={handleKeyDown}
						placeholder={placeholder}
						className={error ? 'border-destructive' : ''}
					/>

					{isOpen && query.length >= 2 && (
						<div className="absolute z-50 w-full mt-1 bg-background/95 backdrop-blur-sm border border-border rounded-md shadow-lg max-h-60 overflow-auto">
							{isLoading ? (
								<div className="p-3 text-sm text-muted-foreground">Searching...</div>
							) : results.length === 0 ? (
								<div className="p-3 text-sm text-muted-foreground">No locations found</div>
							) : (
								<div className="py-1">
									{results.map((result, index) => (
										<button
											key={result.id}
											type="button"
											onClick={() => handleSelect(result)}
											className={`w-full text-left px-3 py-2 hover:bg-accent transition-colors ${
												index === selectedIndex ? 'bg-accent' : ''
											}`}
										>
											<div className="flex items-center justify-between gap-2">
												<div className="flex-1 min-w-0">
													<div className="font-medium truncate">{result.name}</div>
													<div className="text-sm text-muted-foreground truncate">
														{result.systemName} ({result.regionName})
													</div>
												</div>
												<Badge variant={getTypeBadgeVariant(result.type)} className="shrink-0">
													{result.type}
												</Badge>
											</div>
										</button>
									))}
								</div>
							)}
						</div>
					)}
				</div>
			)}

			{error && <p className="text-sm text-destructive">{error}</p>}
		</div>
	)
}
