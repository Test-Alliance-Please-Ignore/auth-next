import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '@/lib/api'

import type {
	CreatePermissionCategoryRequest,
	PermissionCategory,
	UpdatePermissionCategoryRequest,
} from '@/lib/api'

// Query keys
export const permissionCategoryKeys = {
	all: ['admin', 'permissions', 'categories'] as const,
	lists: () => [...permissionCategoryKeys.all, 'list'] as const,
	list: () => [...permissionCategoryKeys.lists()] as const,
}

// Queries

/**
 * Fetch all permission categories
 */
export function usePermissionCategories() {
	return useQuery({
		queryKey: permissionCategoryKeys.list(),
		queryFn: () => api.getPermissionCategories(),
		staleTime: 1000 * 60 * 5, // 5 minutes - categories rarely change
		gcTime: 1000 * 60 * 30, // Keep in cache for 30 minutes
	})
}

// Mutations

/**
 * Create a new permission category
 */
export function useCreatePermissionCategory() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (data: CreatePermissionCategoryRequest) => api.createPermissionCategory(data),
		onSuccess: (newCategory) => {
			// Invalidate categories list to refetch
			void queryClient.invalidateQueries({ queryKey: permissionCategoryKeys.lists() })

			// Optimistically add to cache
			queryClient.setQueryData<PermissionCategory[]>(permissionCategoryKeys.list(), (old) => {
				if (!old) return [newCategory]
				return [...old, newCategory]
			})
		},
	})
}

/**
 * Update an existing permission category
 */
export function useUpdatePermissionCategory() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({ id, data }: { id: string; data: UpdatePermissionCategoryRequest }) =>
			api.updatePermissionCategory(id, data),
		onSuccess: (updatedCategory) => {
			// Invalidate categories list
			void queryClient.invalidateQueries({ queryKey: permissionCategoryKeys.lists() })

			// Update in list cache
			queryClient.setQueryData<PermissionCategory[]>(permissionCategoryKeys.list(), (old) => {
				if (!old) return [updatedCategory]
				return old.map((cat) => (cat.id === updatedCategory.id ? updatedCategory : cat))
			})
		},
	})
}

/**
 * Delete a permission category
 */
export function useDeletePermissionCategory() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (id: string) => api.deletePermissionCategory(id),
		onSuccess: (_, deletedId) => {
			// Invalidate categories list
			void queryClient.invalidateQueries({ queryKey: permissionCategoryKeys.lists() })

			// Remove from list cache
			queryClient.setQueryData<PermissionCategory[]>(permissionCategoryKeys.list(), (old) => {
				if (!old) return []
				return old.filter((cat) => cat.id !== deletedId)
			})
		},
	})
}
