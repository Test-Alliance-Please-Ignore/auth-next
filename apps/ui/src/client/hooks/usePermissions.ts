import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '@/lib/api'

import type {
	CreatePermissionRequest,
	PermissionWithDetails,
	UpdatePermissionRequest,
} from '@/lib/api'

// Query keys
export const permissionKeys = {
	all: ['admin', 'permissions', 'global'] as const,
	lists: () => [...permissionKeys.all, 'list'] as const,
	list: (categoryId?: string) => [...permissionKeys.lists(), { categoryId }] as const,
	details: () => [...permissionKeys.all, 'detail'] as const,
	detail: (id: string) => [...permissionKeys.details(), id] as const,
}

// Queries

/**
 * Fetch all global permissions, optionally filtered by category
 */
export function useGlobalPermissions(categoryId?: string) {
	return useQuery({
		queryKey: permissionKeys.list(categoryId),
		queryFn: () => api.getGlobalPermissions(categoryId),
		staleTime: 1000 * 60 * 5, // 5 minutes
		gcTime: 1000 * 60 * 30, // Keep in cache for 30 minutes
	})
}

/**
 * Fetch a single permission by ID
 */
export function usePermission(id: string) {
	return useQuery({
		queryKey: permissionKeys.detail(id),
		queryFn: () => api.getPermission(id),
		enabled: !!id,
	})
}

// Mutations

/**
 * Create a new global permission
 */
export function useCreatePermission() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (data: CreatePermissionRequest) => api.createPermission(data),
		onSuccess: (newPermission) => {
			// Invalidate all permission lists (they may be filtered by different categories)
			void queryClient.invalidateQueries({ queryKey: permissionKeys.lists() })

			// Optimistically add to the unfiltered cache
			queryClient.setQueryData<PermissionWithDetails[]>(permissionKeys.list(undefined), (old) => {
				if (!old) return [{ ...newPermission, category: null }]
				return [...old, { ...newPermission, category: null }]
			})
		},
	})
}

/**
 * Update an existing global permission
 */
export function useUpdatePermission() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({ id, data }: { id: string; data: UpdatePermissionRequest }) =>
			api.updatePermission(id, data),
		onSuccess: (updatedPermission) => {
			// Invalidate all permission lists
			void queryClient.invalidateQueries({ queryKey: permissionKeys.lists() })

			// Update detail cache
			queryClient.setQueryData(permissionKeys.detail(updatedPermission.id), (old: any) => {
				if (!old) return { ...updatedPermission, category: null }
				return { ...old, ...updatedPermission }
			})

			// Update in list caches
			queryClient.setQueriesData<PermissionWithDetails[]>(
				{ queryKey: permissionKeys.lists() },
				(old) => {
					if (!old) return old
					return old.map((perm) =>
						perm.id === updatedPermission.id ? { ...perm, ...updatedPermission } : perm
					)
				}
			)
		},
	})
}

/**
 * Delete a global permission
 */
export function useDeletePermission() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (id: string) => api.deletePermission(id),
		onSuccess: (_, deletedId) => {
			// Invalidate all permission lists
			void queryClient.invalidateQueries({ queryKey: permissionKeys.lists() })

			// Remove from cache
			queryClient.removeQueries({ queryKey: permissionKeys.detail(deletedId) })

			// Remove from all list caches
			queryClient.setQueriesData<PermissionWithDetails[]>(
				{ queryKey: permissionKeys.lists() },
				(old) => {
					if (!old) return []
					return old.filter((perm) => perm.id !== deletedId)
				}
			)
		},
	})
}
