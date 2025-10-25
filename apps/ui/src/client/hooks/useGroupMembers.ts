import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '@/lib/api'

import { groupKeys } from './useGroups'

import type { GroupMember } from '@/lib/api'

// Query keys
export const groupMemberKeys = {
	all: ['admin', 'group-members'] as const,
	lists: () => [...groupMemberKeys.all, 'list'] as const,
	list: (groupId: string) => [...groupMemberKeys.lists(), groupId] as const,
}

// Queries

/**
 * Fetch members of a group
 */
export function useGroupMembers(groupId: string) {
	return useQuery({
		queryKey: groupMemberKeys.list(groupId),
		queryFn: () => api.getGroupMembers(groupId),
		enabled: !!groupId,
	})
}

// Mutations

/**
 * Remove a member from a group
 */
export function useRemoveMember() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({ groupId, userId }: { groupId: string; userId: string }) =>
			api.removeGroupMember(groupId, userId),
		onSuccess: (_, { groupId, userId }) => {
			// Invalidate members list
			void queryClient.invalidateQueries({ queryKey: groupMemberKeys.list(groupId) })

			// Invalidate group detail (member count may have changed)
			void queryClient.invalidateQueries({ queryKey: groupKeys.detail(groupId) })

			// Optimistically remove from cache
			queryClient.setQueryData<GroupMember[]>(groupMemberKeys.list(groupId), (old) => {
				if (!old) return []
				return old.filter((member) => member.userId !== userId)
			})
		},
	})
}

/**
 * Toggle admin status for a group member
 */
export function useToggleAdmin() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({
			groupId,
			userId,
			isCurrentlyAdmin,
		}: {
			groupId: string
			userId: string
			isCurrentlyAdmin: boolean
		}) => {
			if (isCurrentlyAdmin) {
				return api.removeGroupAdmin(groupId, userId)
			} else {
				return api.addGroupAdmin(groupId, userId)
			}
		},
		onSuccess: (_, { groupId }) => {
			// Invalidate members list to refetch with updated admin status
			void queryClient.invalidateQueries({ queryKey: groupMemberKeys.list(groupId) })

			// Invalidate group detail (admin list may have changed)
			void queryClient.invalidateQueries({ queryKey: groupKeys.detail(groupId) })
		},
	})
}
