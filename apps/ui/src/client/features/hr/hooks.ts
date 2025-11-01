import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
	CheckHrPermissionRequest,
	CheckHrPermissionResult,
	GrantHrRoleRequest,
	HrRoleGrant,
	RevokeHrRoleRequest,
} from './api'
import { hrApi } from './api'

/**
 * Query key factory for HR-related queries
 * Follows the pattern: ['hr', ...scope]
 */
export const hrKeys = {
	all: ['hr'] as const,
	roles: (corporationId: string) => [...hrKeys.all, 'roles', corporationId] as const,
	permission: (corporationId: string) =>
		[...hrKeys.all, 'permission', corporationId] as const,
}

/**
 * Hook to fetch HR roles for a corporation
 * @param corporationId - The corporation ID to fetch roles for
 */
export function useHrRoles(corporationId: string) {
	return useQuery({
		queryKey: hrKeys.roles(corporationId),
		queryFn: () => hrApi.listHrRoles(corporationId),
		enabled: !!corporationId,
		staleTime: 10 * 60 * 1000, // 10 minutes (HR roles change infrequently)
	})
}

/**
 * Hook to check HR permission for the current authenticated user
 * @param request - Permission check request (userId derived from session)
 */
export function useHrPermissionCheck(request: CheckHrPermissionRequest | null) {
	return useQuery({
		queryKey: request
			? hrKeys.permission(request.corporationId)
			: ['hr', 'permission', 'null'],
		queryFn: () => {
			if (!request) throw new Error('No request provided')
			return hrApi.checkHrPermission(request)
		},
		enabled: !!request,
		staleTime: 10 * 60 * 1000, // 10 minutes (HR roles change infrequently)
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
			queryClient.invalidateQueries({
				queryKey: hrKeys.roles(variables.corporationId),
				refetchType: 'active', // Force refetch active queries
			})

			// Invalidate all HR permission checks for this corporation
			// Note: Permission checks are now per-corporation only (user is from session)
			queryClient.invalidateQueries({
				queryKey: hrKeys.permission(variables.corporationId),
				refetchType: 'active',
			})

			// Invalidate corporation members to refresh the table
			queryClient.invalidateQueries({
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
			queryClient.invalidateQueries({
				queryKey: hrKeys.roles(variables.corporationId),
				refetchType: 'active', // Force refetch active queries
			})

			// Invalidate all HR permission checks for this corporation
			// Note: Permission checks are now per-corporation only (user is from session)
			queryClient.invalidateQueries({
				queryKey: hrKeys.permission(variables.corporationId),
				refetchType: 'active',
			})

			// Invalidate corporation members to refresh the table
			queryClient.invalidateQueries({
				queryKey: ['my-corporations', 'members', variables.corporationId],
				refetchType: 'active',
			})
		},
	})
}
