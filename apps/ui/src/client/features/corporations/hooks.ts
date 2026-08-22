/**
 * Corporations Feature Hooks
 *
 * React Query hooks for managing corporation data fetching and caching.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'

import { ROLE_CORE_ALLIANCE_MEMBER } from '@repo/core'

import { useAuth } from '@/hooks/useAuth'

import { myCorporationsApi } from './api'

import type {
	CorporationAccessResult,
	CorporationMemberAccountResponse,
	CorporationMembersQuery,
	CorporationMembersResponse,
	CorporationScopedAccessResult,
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
	memberAccount: (corpId: string, accountId: string) =>
		[...corporationKeys.all, 'member-account', corpId, accountId] as const,
	access: () => [...corporationKeys.all, 'access'] as const,
	accessForCorporation: (corpId: string) => [...corporationKeys.all, 'access', corpId] as const,
	coverage: () => [...corporationKeys.all, 'coverage'] as const,
}

function canUseCorporationAccess(
	user: { is_admin?: boolean; roles?: string[] } | null | undefined
) {
	return user?.is_admin === true || user?.roles?.includes(ROLE_CORE_ALLIANCE_MEMBER) === true
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Hook for quick check if user has any corporation access (for navigation)
 * This is optimized for speed and should be used in the sidebar
 */
export function useHasCorporationAccess() {
	const { user } = useAuth()
	const userId = user?.id ?? null
	const hasCorporationAccessCapability = canUseCorporationAccess(user)

	return useQuery({
		queryKey: ['my-corporations', 'has-access', userId, hasCorporationAccessCapability],
		queryFn: () => myCorporationsApi.hasAccess(),
		staleTime: 1000 * 60 * 5, // 5 minutes
		gcTime: 1000 * 60 * 10, // 10 minutes
		// The API is alliance-member scoped. Do not probe it for authenticated
		// sessions that cannot use the surrounding corporation features.
		enabled: userId !== null && hasCorporationAccessCapability,
	})
}

/**
 * Format a corporation role for user-facing display.
 */
export function formatCorporationRoleLabel(
	role: 'CEO' | 'Director' | 'admin' | 'hr_admin' | 'hr_reviewer' | 'hr_viewer' | null | undefined
): string {
	switch (role) {
		case 'CEO':
			return 'CEO'
		case 'Director':
			return 'Director'
		case 'admin':
			return 'Site Admin'
		case 'hr_admin':
			return 'HR Admin'
		case 'hr_reviewer':
			return 'HR Reviewer'
		case 'hr_viewer':
			return 'HR Viewer'
		default:
			return 'Unknown'
	}
}

/**
 * Hook to get full corporation access details
 * This returns the complete list of accessible corporations
 */
export function useCorporationAccess() {
	const { user } = useAuth()
	const userId = user?.id ?? null
	const hasCorporationAccessCapability = canUseCorporationAccess(user)

	return useQuery<CorporationAccessResult>({
		queryKey: [...corporationKeys.access(), userId, hasCorporationAccessCapability],
		queryFn: () => myCorporationsApi.checkAccess(),
		staleTime: 1000 * 60 * 5, // 5 minutes
		gcTime: 1000 * 60 * 10, // 10 minutes (formerly cacheTime)
		enabled: userId !== null && hasCorporationAccessCapability,
	})
}

/**
 * Hook to fetch ESI coverage statistics independently from corporation access.
 * The backend shares the per-corporation cache across authorized users.
 */
export function useCorporationCoverage() {
	const { user } = useAuth()
	const userId = user?.id ?? null
	const hasCorporationAccessCapability = canUseCorporationAccess(user)

	return useQuery({
		queryKey: [...corporationKeys.coverage(), userId, hasCorporationAccessCapability],
		queryFn: () => myCorporationsApi.getCoverage(),
		staleTime: 10 * 60 * 1000,
		gcTime: 30 * 60 * 1000,
		enabled: userId !== null && hasCorporationAccessCapability,
	})
}

/**
 * Hook to fetch user's corporations with leadership roles
 */
export function useMyCorporations() {
	const { user } = useAuth()
	const userId = user?.id ?? null
	const hasCorporationAccessCapability = canUseCorporationAccess(user)

	return useQuery<MyCorporation[]>({
		queryKey: [...corporationKeys.list(), userId, hasCorporationAccessCapability],
		queryFn: () => myCorporationsApi.getMyCorporations(),
		staleTime: 1000 * 60 * 2, // 2 minutes
		gcTime: 1000 * 60 * 5, // 5 minutes
		enabled: userId !== null && hasCorporationAccessCapability,
	})
}

/**
 * Hook to fetch corporation members
 */
export function useCorporationMembers(
	corporationId: string,
	query: CorporationMembersQuery,
	options?: { enabled?: boolean }
) {
	return useQuery<CorporationMembersResponse>({
		queryKey: corporationKeys.members(corporationId, query),
		queryFn: () => myCorporationsApi.getCorporationMembers(corporationId, query),
		placeholderData: (previousData) => previousData,
		staleTime: 1000 * 60, // 1 minute
		gcTime: 1000 * 60 * 3, // 3 minutes
		enabled: options?.enabled ?? !!corporationId,
	})
}

export function useCorporationMemberAccount(corporationId: string, accountId: string) {
	return useQuery<CorporationMemberAccountResponse>({
		queryKey: corporationKeys.memberAccount(corporationId, accountId),
		queryFn: () => myCorporationsApi.getCorporationMemberAccount(corporationId, accountId),
		meta: {
			suppressErrorToast: true,
		},
		staleTime: 1000 * 60,
		gcTime: 1000 * 60 * 3,
		enabled: Boolean(corporationId && accountId),
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
				linkedUsers: 0,
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
		const linkedUsers = members.summary.linkedUsers
		const unlinked = total - linked
		const active = members.summary.active
		const inactive = members.summary.inactive
		const ceos = 0
		const directors = members.summary.directors

		return {
			total,
			linked,
			linkedUsers,
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
 * Hook to check access for a specific corporation.
 */
export function useCanAccessCorporation(corporationId: string) {
	const { user } = useAuth()
	const userId = user?.id ?? null

	const {
		data: access,
		isLoading,
		isFetching,
	} = useQuery<CorporationScopedAccessResult>({
		// The API derives the caller from the session, so access results must be
		// isolated per authenticated user in the client cache.
		queryKey: [...corporationKeys.accessForCorporation(corporationId), userId],
		queryFn: () => myCorporationsApi.getCorporationAccess(corporationId),
		enabled: Boolean(corporationId) && userId !== null,
		staleTime: 1000 * 60 * 5,
		gcTime: 1000 * 60 * 10,
		meta: {
			suppressErrorToast: true,
		},
	})

	const canAccess = access?.hasAccess ?? false
	const corporation = access?.corporation ?? undefined
	const userRole = access?.userRole ?? undefined

	return { canAccess, userRole, corporation, isLoading, isFetching }
}
