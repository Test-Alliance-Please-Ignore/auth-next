import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '@/lib/api'

import type {
	Category,
	CategoryWithGroups,
	CreateCategoryRequest,
	UpdateCategoryRequest,
} from '@/lib/api'

// Query keys
export const categoryKeys = {
	all: ['admin', 'categories'] as const,
	lists: () => [...categoryKeys.all, 'list'] as const,
	list: () => [...categoryKeys.lists()] as const,
	details: () => [...categoryKeys.all, 'detail'] as const,
	detail: (id: string) => [...categoryKeys.details(), id] as const,
}

// Queries

/**
 * Fetch all categories
 */
export function useCategories() {
	return useQuery({
		queryKey: categoryKeys.list(),
		queryFn: () => api.getCategories(),
		staleTime: 1000 * 60 * 5, // 5 minutes - categories rarely change
		gcTime: 1000 * 60 * 30, // Keep in cache for 30 minutes
	})
}

/**
 * Fetch a single category by ID with its groups
 */
export function useCategory(id: string) {
	return useQuery({
		queryKey: categoryKeys.detail(id),
		queryFn: () => api.getCategory(id),
		enabled: !!id,
	})
}

// Mutations

/**
 * Create a new category
 */
export function useCreateCategory() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (data: CreateCategoryRequest) => api.createCategory(data),
		onSuccess: (newCategory) => {
			// Invalidate categories list to refetch
			void queryClient.invalidateQueries({ queryKey: categoryKeys.lists() })

			// Optimistically add to cache
			queryClient.setQueryData<Category[]>(categoryKeys.list(), (old) => {
				if (!old) return [newCategory]
				return [...old, newCategory]
			})
		},
	})
}

/**
 * Update an existing category
 */
export function useUpdateCategory() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({ id, data }: { id: string; data: UpdateCategoryRequest }) =>
			api.updateCategory(id, data),
		onSuccess: (updatedCategory) => {
			// Invalidate categories list
			void queryClient.invalidateQueries({ queryKey: categoryKeys.lists() })

			// Update category detail cache
			queryClient.setQueryData(
				categoryKeys.detail(updatedCategory.id),
				(old: CategoryWithGroups | undefined) => {
					if (!old) return updatedCategory
					return { ...old, ...updatedCategory }
				}
			)

			// Update in list cache
			queryClient.setQueryData<Category[]>(categoryKeys.list(), (old) => {
				if (!old) return [updatedCategory]
				return old.map((cat) => (cat.id === updatedCategory.id ? updatedCategory : cat))
			})
		},
	})
}

/**
 * Delete a category
 */
export function useDeleteCategory() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (id: string) => api.deleteCategory(id),
		onSuccess: (_, deletedId) => {
			// Invalidate categories list
			void queryClient.invalidateQueries({ queryKey: categoryKeys.lists() })

			// Remove from cache
			queryClient.removeQueries({ queryKey: categoryKeys.detail(deletedId) })

			// Remove from list cache
			queryClient.setQueryData<Category[]>(categoryKeys.list(), (old) => {
				if (!old) return []
				return old.filter((cat) => cat.id !== deletedId)
			})
		},
	})
}
