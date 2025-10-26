import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '@/lib/api'

import type {
	AttachPermissionRequest,
	CreateGroupScopedPermissionRequest,
	GroupPermissionWithDetails,
	UpdateGroupPermissionRequest,
} from '@/lib/api'

// Query keys
export const groupPermissionKeys = {
	all: ['admin', 'groups', 'permissions'] as const,
	lists: () => [...groupPermissionKeys.all, 'list'] as const,
	list: (groupId: string) => [...groupPermissionKeys.lists(), groupId] as const,
	memberPermissions: (groupId: string) => [
		...groupPermissionKeys.all,
		'members',
		groupId,
	] as const,
	userPermissions: (userId: string) => [...groupPermissionKeys.all, 'user', userId] as const,
	multiGroupPermissions: (groupIds: string[]) => [
		...groupPermissionKeys.all,
		'multi',
		{ groupIds },
	] as const,
}

// Queries

/**
 * Fetch permissions for a specific group
 */
export function useGroupPermissions(groupId: string) {
	return useQuery({
		queryKey: groupPermissionKeys.list(groupId),
		queryFn: () => api.getGroupPermissions(groupId),
		enabled: !!groupId,
		staleTime: 1000 * 60 * 2, // 2 minutes
	})
}

/**
 * Fetch permissions for all members of a group
 */
export function useGroupMemberPermissions(groupId: string) {
	return useQuery({
		queryKey: groupPermissionKeys.memberPermissions(groupId),
		queryFn: () => api.getGroupMemberPermissions(groupId),
		enabled: !!groupId,
		staleTime: 1000 * 60 * 2, // 2 minutes
	})
}

/**
 * Fetch permissions for a specific user across all their groups
 */
export function useUserPermissions(userId: string) {
	return useQuery({
		queryKey: groupPermissionKeys.userPermissions(userId),
		queryFn: () => api.getUserPermissions(userId),
		enabled: !!userId,
		staleTime: 1000 * 60 * 2, // 2 minutes
	})
}

/**
 * Fetch permissions for members across multiple groups
 */
export function useMultiGroupMemberPermissions(groupIds: string[]) {
	return useQuery({
		queryKey: groupPermissionKeys.multiGroupPermissions(groupIds),
		queryFn: () => api.getMultiGroupMemberPermissions(groupIds),
		enabled: groupIds.length > 0,
		staleTime: 1000 * 60 * 2, // 2 minutes
	})
}

// Mutations

/**
 * Attach a global permission to a group
 */
export function useAttachPermission() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (data: AttachPermissionRequest) => api.attachPermissionToGroup(data),
		onSuccess: (newGroupPermission, variables) => {
			// Invalidate the group's permissions list
			void queryClient.invalidateQueries({
				queryKey: groupPermissionKeys.list(variables.groupId),
			})

			// Invalidate member permissions for this group
			void queryClient.invalidateQueries({
				queryKey: groupPermissionKeys.memberPermissions(variables.groupId),
			})

			// Optimistically add to cache
			queryClient.setQueryData<GroupPermissionWithDetails[]>(
				groupPermissionKeys.list(variables.groupId),
				(old) => {
					if (!old) return [newGroupPermission]
					return [...old, newGroupPermission]
				}
			)
		},
	})
}

/**
 * Create a group-scoped custom permission
 */
export function useCreateGroupScopedPermission() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (data: CreateGroupScopedPermissionRequest) => api.createGroupScopedPermission(data),
		onSuccess: (newGroupPermission, variables) => {
			// Invalidate the group's permissions list
			void queryClient.invalidateQueries({
				queryKey: groupPermissionKeys.list(variables.groupId),
			})

			// Invalidate member permissions for this group
			void queryClient.invalidateQueries({
				queryKey: groupPermissionKeys.memberPermissions(variables.groupId),
			})

			// Optimistically add to cache
			queryClient.setQueryData<GroupPermissionWithDetails[]>(
				groupPermissionKeys.list(variables.groupId),
				(old) => {
					if (!old) return [newGroupPermission]
					return [...old, newGroupPermission]
				}
			)
		},
	})
}

/**
 * Update a group permission (change target type or custom fields)
 */
export function useUpdateGroupPermission() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({ id, data }: { id: string; data: UpdateGroupPermissionRequest }) =>
			api.updateGroupPermission(id, data),
		onSuccess: (updatedGroupPermission) => {
			const groupId = updatedGroupPermission.group.id

			// Invalidate the group's permissions list
			void queryClient.invalidateQueries({ queryKey: groupPermissionKeys.list(groupId) })

			// Invalidate member permissions for this group
			void queryClient.invalidateQueries({
				queryKey: groupPermissionKeys.memberPermissions(groupId),
			})

			// Update in cache
			queryClient.setQueryData<GroupPermissionWithDetails[]>(
				groupPermissionKeys.list(groupId),
				(old) => {
					if (!old) return [updatedGroupPermission]
					return old.map((perm) =>
						perm.id === updatedGroupPermission.id ? updatedGroupPermission : perm
					)
				}
			)
		},
	})
}

/**
 * Remove a permission from a group
 */
export function useRemoveGroupPermission() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({ id }: { id: string; groupId: string }) =>
			api.removePermissionFromGroup(id),
		onSuccess: (_, variables) => {
			// Invalidate the group's permissions list
			void queryClient.invalidateQueries({
				queryKey: groupPermissionKeys.list(variables.groupId),
			})

			// Invalidate member permissions for this group
			void queryClient.invalidateQueries({
				queryKey: groupPermissionKeys.memberPermissions(variables.groupId),
			})

			// Remove from cache
			queryClient.setQueryData<GroupPermissionWithDetails[]>(
				groupPermissionKeys.list(variables.groupId),
				(old) => {
					if (!old) return []
					return old.filter((perm) => perm.id !== variables.id)
				}
			)
		},
	})
}
