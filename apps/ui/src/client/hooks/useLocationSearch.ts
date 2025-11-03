import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { esiApi } from '@/lib/esi-api'

import type { EsiLocationSearchResult } from '@/lib/esi-api'

// Query keys
export const locationSearchKeys = {
	all: ['location-search'] as const,
	search: (query: string) => [...locationSearchKeys.all, 'search', query] as const,
}

/**
 * Debounced location search hook
 * Searches across systems, stations, and structures
 */
export function useLocationSearch(query: string, enabled = true) {
	const [debouncedQuery, setDebouncedQuery] = useState(query)

	// Debounce the search query
	useEffect(() => {
		const timer = setTimeout(() => {
			setDebouncedQuery(query)
		}, 500) // 500ms debounce

		return () => clearTimeout(timer)
	}, [query])

	return useQuery({
		queryKey: locationSearchKeys.search(debouncedQuery),
		queryFn: () => esiApi.searchLocations(debouncedQuery),
		enabled: enabled && debouncedQuery.length >= 2,
		staleTime: 1000 * 60 * 5, // 5 minutes - location names don't change often
	})
}

/**
 * Get system details by ID
 */
export function useSystemDetails(systemId: string | undefined) {
	return useQuery({
		queryKey: ['system-details', systemId] as const,
		queryFn: () => esiApi.getSystemDetails(systemId!),
		enabled: !!systemId,
		staleTime: 1000 * 60 * 30, // 30 minutes - systems are static
	})
}

/**
 * Get station details by ID
 */
export function useStationDetails(stationId: string | undefined) {
	return useQuery({
		queryKey: ['station-details', stationId] as const,
		queryFn: () => esiApi.getStationDetails(stationId!),
		enabled: !!stationId,
		staleTime: 1000 * 60 * 30, // 30 minutes - stations are static
	})
}

/**
 * Get structure details by ID
 */
export function useStructureDetails(structureId: string | undefined) {
	return useQuery({
		queryKey: ['structure-details', structureId] as const,
		queryFn: () => esiApi.getStructureDetails(structureId!),
		enabled: !!structureId,
		staleTime: 1000 * 60 * 5, // 5 minutes - structures can be renamed
	})
}
