/**
 * Corporations Feature Hooks
 *
 * React Query hooks for managing corporation data fetching and caching.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'

import { myCorporationsApi } from './api'

import type {
	CorporationAccessResult,
	CorporationMembersQuery,
	CorporationMembersResponse,
	MyCorporation,
} from './api'

// ============================================================================
// Query Key Factory
// ============================================================================

/**
 * Query key factory for consistent cache key generation
 */
export const corporationKeys = {
	all: ['my-corporations'] as const,
	lists: () => [...corporationKeys.all, 'list'] as const,
	list: () => [...corporationKeys.lists()] as const,
	members: (corpId: string, query: CorporationMembersQuery) =>
		[...corporationKeys.all, 'members', corpId, query] as const,
	access: () => [...corporationKeys.all, 'access'] as const,
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Hook for quick check if user has any corporation access (for navigation)
 * This is optimized for speed and should be used in the sidebar
 */
export function useHasCorporationAccess() {
	return useQuery({
		queryKey: ['my-corporations', 'has-access'],
		queryFn: () => myCorporationsApi.hasAccess(),
		staleTime: 1000 * 60 * 5, // 5 minutes
		gcTime: 1000 * 60 * 10, // 10 minutes
	})
}

/**
 * Hook to get full corporation access details
 * This returns the complete list of accessible corporations
 */
export function useCorporationAccess() {
	return useQuery<CorporationAccessResult>({
		queryKey: corporationKeys.access(),
		queryFn: () => myCorporationsApi.checkAccess(),
		staleTime: 1000 * 60 * 5, // 5 minutes
		gcTime: 1000 * 60 * 10, // 10 minutes (formerly cacheTime)
	})
}

/**
 * Hook to fetch user's corporations with leadership roles
 */
export function useMyCorporations() {
	return useQuery<MyCorporation[]>({
		queryKey: corporationKeys.list(),
		queryFn: () => myCorporationsApi.getMyCorporations(),
		staleTime: 1000 * 60 * 2, // 2 minutes
		gcTime: 1000 * 60 * 5, // 5 minutes
	})
}

/**
 * Hook to fetch corporation members
 */
export function useCorporationMembers(corporationId: string, query: CorporationMembersQuery) {
	return useQuery<CorporationMembersResponse>({
		queryKey: corporationKeys.members(corporationId, query),
		queryFn: () => myCorporationsApi.getCorporationMembers(corporationId, query),
		placeholderData: (previousData) => previousData,
		staleTime: 1000 * 60, // 1 minute
		gcTime: 1000 * 60 * 3, // 3 minutes
		enabled: !!corporationId,
	})
}

/**
 * Hook to manage corporation data with cache invalidation
 */
export function useCorporationManager() {
	const queryClient = useQueryClient()

	const invalidateAccess = useCallback(() => {
		return queryClient.invalidateQueries({
			queryKey: corporationKeys.access(),
		})
	}, [queryClient])

	const invalidateCorporations = useCallback(() => {
		return queryClient.invalidateQueries({
			queryKey: corporationKeys.list(),
		})
	}, [queryClient])

	const invalidateMembers = useCallback(
		(corporationId: string) => {
			return queryClient.invalidateQueries({
				queryKey: [...corporationKeys.all, 'members', corporationId],
			})
		},
		[queryClient]
	)

	const invalidateAll = useCallback(() => {
		return queryClient.invalidateQueries({
			queryKey: corporationKeys.all,
		})
	}, [queryClient])

	const prefetchMembers = useCallback(
		(corporationId: string) => {
			return queryClient.prefetchQuery({
				queryKey: corporationKeys.members(corporationId, {}),
				queryFn: () => myCorporationsApi.getCorporationMembers(corporationId, {}),
				staleTime: 1000 * 60, // 1 minute
			})
		},
		[queryClient]
	)

	return {
		invalidateAccess,
		invalidateCorporations,
		invalidateMembers,
		invalidateAll,
		prefetchMembers,
	}
}

// ============================================================================
// Composite Hooks
// ============================================================================

/**
 * Hook to get a specific corporation from the cached list
 */
export function useMyCorporation(corporationId: string) {
	const { data: corporations, ...query } = useMyCorporations()

	const corporation = useMemo(() => {
		if (!corporations) return undefined
		return corporations.find((corp) => corp.corporationId === corporationId)
	}, [corporations, corporationId])

	return {
		...query,
		data: corporation,
	}
}

/**
 * Hook to get member statistics for a corporation
 */
export function useCorporationMemberStats(corporationId: string) {
	const { data: members, ...query } = useCorporationMembers(corporationId, {})

	const stats = useMemo(() => {
		if (!members)
			return {
				total: 0,
				linked: 0,
				unlinked: 0,
				active: 0,
				inactive: 0,
				ceos: 0,
				directors: 0,
				linkPercentage: 0,
				activePercentage: 0,
			}

		const total = members.summary.total
		const linked = members.summary.linked
		const unlinked = total - linked
		const active = members.summary.active
		const inactive = members.summary.inactive
		const ceos = 0
		const directors = members.summary.directors

		return {
			total,
			linked,
			unlinked,
			active,
			inactive,
			ceos,
			directors,
			linkPercentage: total > 0 ? Math.round((linked / total) * 100) : 0,
			activePercentage: total > 0 ? Math.round((active / total) * 100) : 0,
		}
	}, [members])

	return {
		...query,
		data: stats,
	}
}

/**
 * Hook to check if user can access a specific corporation
 */
export function useCanAccessCorporation(corporationId: string) {
	const { data: access, isLoading, isFetching } = useCorporationAccess()

	const canAccess = useMemo(() => {
		if (!access) return false
		return access.corporations.some((corp) => corp.corporationId === corporationId)
	}, [access, corporationId])

	const corporation = useMemo(() => {
		if (!access) return undefined
		return access.corporations.find((c) => c.corporationId === corporationId)
	}, [access, corporationId])

	const userRole = corporation?.userRole

	return { canAccess, userRole, corporation, isLoading, isFetching }
}
