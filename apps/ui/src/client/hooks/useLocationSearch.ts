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

// Query keys for system-only search
export const systemSearchKeys = {
	all: ['system-search'] as const,
	search: (query: string) => [...systemSearchKeys.all, 'search', query] as const,
}

/**
 * Debounced system search hook
 * Searches solar systems only (not stations or structures)
 * ESI search requires a minimum of 3 characters.
 * Returns `isPending` when the query is debouncing but hasn't fired yet.
 */
export function useSystemSearch(query: string, enabled = true) {
	const [debouncedQuery, setDebouncedQuery] = useState(query)

	useEffect(() => {
		const timer = setTimeout(() => {
			setDebouncedQuery(query)
		}, 500)

		return () => clearTimeout(timer)
	}, [query])

	const result = useQuery({
		queryKey: systemSearchKeys.search(debouncedQuery),
		queryFn: () => esiApi.searchSystems(debouncedQuery),
		enabled: enabled && debouncedQuery.length >= 3,
		staleTime: 1000 * 60 * 5, // 5 minutes - system names don't change
	})

	// True when input meets minimum length but the debounce timer hasn't fired yet
	const isDebouncing = query.trim().length >= 3 && query !== debouncedQuery

	return { ...result, isPending: isDebouncing, isDebouncing }
}
