import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { useAuth } from '@/hooks/useAuth'

import { hrApi } from './api'

import type {
	CheckHrPermissionRequest,
	GrantHrRoleRequest,
	HrAccessibleCorporation,
	HrUserSearchResult,
	RevokeHrRoleRequest,
} from './api'

/**
 * Query key factory for HR-related queries
 * Follows the pattern: ['hr', ...scope]
 */
export const hrKeys = {
	all: ['hr'] as const,
	roles: (corporationId: string) => [...hrKeys.all, 'roles', corporationId] as const,
	permission: (corporationId: string) => [...hrKeys.all, 'permission', corporationId] as const,
	corporations: () => [...hrKeys.all, 'corporations'] as const,
	userSearch: (query: { search?: string; limit?: number; offset?: number }) =>
		[...hrKeys.all, 'user-search', query] as const,
}

export function useHrUserSearch(
	query: { search?: string; limit?: number; offset?: number },
	options?: { enabled?: boolean }
) {
	return useQuery<HrUserSearchResult>({
		queryKey: hrKeys.userSearch(query),
		queryFn: () => hrApi.searchUsers(query),
		placeholderData: (previousData) => previousData,
		staleTime: 30 * 1000,
		gcTime: 3 * 60 * 1000,
		enabled: options?.enabled ?? true,
		meta: { suppressErrorToast: true },
	})
}

/**
 * Hook to fetch HR roles for a corporation
 * @param corporationId - The corporation ID to fetch roles for
 */
export function useHrRoles(corporationId: string, options?: { enabled?: boolean }) {
	return useQuery({
		queryKey: hrKeys.roles(corporationId),
		queryFn: () => hrApi.listHrRoles(corporationId),
		enabled: options?.enabled ?? !!corporationId,
		staleTime: 10 * 60 * 1000, // 10 minutes (HR roles change infrequently)
	})
}

/**
 * Hook to check HR permission for the current authenticated user
 * @param request - Permission check request (userId derived from session)
 */
export function useHrPermissionCheck(request: CheckHrPermissionRequest | null) {
	const { user } = useAuth()
	const userId = user?.id ?? null

	return useQuery({
		// The API derives the user from the session, so the session user and role
		// requirement must be part of the client cache identity as well.
		queryKey: request
			? [...hrKeys.permission(request.corporationId), userId, request.requiredRole ?? null]
			: ['hr', 'permission', 'null'],
		queryFn: () => {
			if (!request) throw new Error('No request provided')
			return hrApi.checkHrPermission(request)
		},
		enabled: !!request && userId !== null,
		staleTime: 10 * 60 * 1000, // 10 minutes (HR roles change infrequently)
	})
}

/**
 * Hook to list corporations where current user has HR access
 */
export function useHrAccessibleCorporations(options?: { enabled?: boolean }) {
	const { user } = useAuth()
	const userId = user?.id ?? null

	return useQuery<HrAccessibleCorporation[]>({
		queryKey: [...hrKeys.corporations(), userId],
		queryFn: () => hrApi.listAccessibleCorporations(),
		staleTime: 5 * 60 * 1000,
		enabled: (options?.enabled ?? true) && userId !== null,
	})
}

/**
 * Hook to grant an HR role
 * Invalidates the HR roles and corporation members queries on success
 */
export function useGrantHrRole() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (request: GrantHrRoleRequest) => hrApi.grantHrRole(request),
		onSuccess: (data, variables) => {
			// Invalidate HR roles for this corporation
			void queryClient.invalidateQueries({
				queryKey: hrKeys.roles(variables.corporationId),
				refetchType: 'active', // Force refetch active queries
			})

			// Invalidate all HR permission checks for this corporation
			// Note: Permission checks are now per-corporation only (user is from session)
			void queryClient.invalidateQueries({
				queryKey: hrKeys.permission(variables.corporationId),
				refetchType: 'active',
			})

			// Invalidate corporation members to refresh the table
			void queryClient.invalidateQueries({
				queryKey: ['my-corporations', 'members', variables.corporationId],
				refetchType: 'active',
			})
		},
	})
}

/**
 * Hook to revoke an HR role
 * Invalidates the HR roles and corporation members queries on success
 */
export function useRevokeHrRole() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (request: RevokeHrRoleRequest) => hrApi.revokeHrRole(request),
		onSuccess: (data, variables) => {
			// Invalidate HR roles for this corporation
			void queryClient.invalidateQueries({
				queryKey: hrKeys.roles(variables.corporationId),
				refetchType: 'active', // Force refetch active queries
			})

			// Invalidate all HR permission checks for this corporation
			// Note: Permission checks are now per-corporation only (user is from session)
			void queryClient.invalidateQueries({
				queryKey: hrKeys.permission(variables.corporationId),
				refetchType: 'active',
			})

			// Invalidate corporation members to refresh the table
			void queryClient.invalidateQueries({
				queryKey: ['my-corporations', 'members', variables.corporationId],
				refetchType: 'active',
			})
		},
	})
}
