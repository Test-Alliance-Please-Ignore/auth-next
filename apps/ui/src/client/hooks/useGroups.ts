import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type {
	CreateGroupRequest,
	CreateJoinRequestRequest,
	GroupWithDetails,
	GroupsFilters,
	UpdateGroupRequest,
} from '@/lib/api'

// Query keys
export const groupKeys = {
	all: ['admin', 'groups'] as const,
	lists: () => [...groupKeys.all, 'list'] as const,
	list: (filters?: GroupsFilters) => [...groupKeys.lists(), filters] as const,
	details: () => [...groupKeys.all, 'detail'] as const,
	detail: (id: string) => [...groupKeys.details(), id] as const,
	userMemberships: () => ['user', 'groups', 'memberships'] as const,
	invitations: () => ['user', 'groups', 'invitations'] as const,
	groupInvitations: (groupId: string) => ['groups', groupId, 'invitations'] as const,
	joinRequests: (groupId: string) => ['groups', groupId, 'join-requests'] as const,
	characterSearch: (query: string) => ['characters', 'search', query] as const,
}

// Queries

/**
 * Fetch groups with optional filters
 */
export function useGroups(filters?: GroupsFilters) {
	// Determine cache time based on filters
	const isUserSpecific = filters?.myGroups || filters?.search

	return useQuery({
		queryKey: groupKeys.list(filters),
		queryFn: () => api.getGroups(filters),
		// Unfiltered lists can be cached longer since they're edge-cached
		staleTime: isUserSpecific ? 1000 * 30 : 1000 * 60, // 30s for user-specific, 60s for general
		gcTime: 1000 * 60 * 5, // Keep in cache for 5 minutes
	})
}

/**
 * Fetch a single group by ID with full details
 */
export function useGroup(id: string) {
	return useQuery({
		queryKey: groupKeys.detail(id),
		queryFn: () => api.getGroup(id),
		enabled: !!id,
	})
}

// Mutations

/**
 * Create a new group
 */
export function useCreateGroup() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (data: CreateGroupRequest) => api.createGroup(data),
		onSuccess: (_newGroup) => {
			// Invalidate all group lists (they may have different filters)
			void queryClient.invalidateQueries({ queryKey: groupKeys.lists() })

			// Optimistically add to cache (for unfiltered lists)
			queryClient.setQueriesData<GroupWithDetails[]>({ queryKey: groupKeys.lists() }, (old) => {
				if (!old) return old
				// Note: We can't reliably add it to all filtered caches since we don't know
				// which filters would include it, so we just invalidate
				return old
			})
		},
	})
}

/**
 * Update an existing group
 */
export function useUpdateGroup() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({ id, data }: { id: string; data: UpdateGroupRequest }) => api.updateGroup(id, data),
		onSuccess: (updatedGroup) => {
			// Invalidate all group lists (they may have different filters)
			void queryClient.invalidateQueries({ queryKey: groupKeys.lists() })

			// Update group detail cache
			queryClient.setQueryData(groupKeys.detail(updatedGroup.id), (old: GroupWithDetails | undefined) => {
				if (!old) return updatedGroup
				return { ...old, ...updatedGroup }
			})

			// Update in any list caches
			queryClient.setQueriesData<GroupWithDetails[]>({ queryKey: groupKeys.lists() }, (old) => {
				if (!old) return old
				return old.map((group) => (group.id === updatedGroup.id ? { ...group, ...updatedGroup } : group))
			})
		},
	})
}

/**
 * Delete a group
 */
export function useDeleteGroup() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (id: string) => api.deleteGroup(id),
		onSuccess: (_, deletedId) => {
			// Invalidate all group lists
			void queryClient.invalidateQueries({ queryKey: groupKeys.lists() })

			// Remove from detail cache
			queryClient.removeQueries({ queryKey: groupKeys.detail(deletedId) })

			// Remove from all list caches
			queryClient.setQueriesData<GroupWithDetails[]>({ queryKey: groupKeys.lists() }, (old) => {
				if (!old) return []
				return old.filter((group) => group.id !== deletedId)
			})
		},
	})
}

// ===== User-Facing Hooks =====

/**
 * Get user's group memberships
 */
export function useUserMemberships() {
	return useQuery({
		queryKey: groupKeys.userMemberships(),
		queryFn: () => api.getUserMemberships(),
	})
}

/**
 * Join a group
 */
export function useJoinGroup() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (groupId: string) => api.joinGroup(groupId),
		onSuccess: () => {
			// Invalidate group lists and user memberships
			void queryClient.invalidateQueries({ queryKey: groupKeys.lists() })
			void queryClient.invalidateQueries({ queryKey: groupKeys.userMemberships() })
		},
	})
}

/**
 * Leave a group
 */
export function useLeaveGroup() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (groupId: string) => api.leaveGroup(groupId),
		onSuccess: () => {
			// Invalidate group lists and user memberships
			void queryClient.invalidateQueries({ queryKey: groupKeys.lists() })
			void queryClient.invalidateQueries({ queryKey: groupKeys.userMemberships() })
		},
	})
}

/**
 * Create a join request
 */
export function useCreateJoinRequest() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (data: CreateJoinRequestRequest) => api.createJoinRequest(data),
		onSuccess: () => {
			// Invalidate group details to show pending request status
			void queryClient.invalidateQueries({ queryKey: groupKeys.details() })
		},
	})
}

/**
 * Get join requests for a group
 */
export function useJoinRequests(groupId: string) {
	return useQuery({
		queryKey: groupKeys.joinRequests(groupId),
		queryFn: () => api.getJoinRequests(groupId),
		enabled: !!groupId,
	})
}

/**
 * Approve a join request
 */
export function useApproveJoinRequest() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (requestId: string) => api.approveJoinRequest(requestId),
		onSuccess: () => {
			// Invalidate join requests and group details
			void queryClient.invalidateQueries({ queryKey: ['groups'] })
		},
	})
}

/**
 * Reject a join request
 */
export function useRejectJoinRequest() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (requestId: string) => api.rejectJoinRequest(requestId),
		onSuccess: () => {
			// Invalidate join requests
			void queryClient.invalidateQueries({ queryKey: ['groups'] })
		},
	})
}

/**
 * Get pending invitations for the current user
 */
export function usePendingInvitations() {
	return useQuery({
		queryKey: groupKeys.invitations(),
		queryFn: () => api.getPendingInvitations(),
	})
}

/**
 * Accept an invitation
 */
export function useAcceptInvitation() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (invitationId: string) => api.acceptInvitation(invitationId),
		onSuccess: () => {
			// Invalidate invitations and user memberships
			void queryClient.invalidateQueries({ queryKey: groupKeys.invitations() })
			void queryClient.invalidateQueries({ queryKey: groupKeys.userMemberships() })
			void queryClient.invalidateQueries({ queryKey: groupKeys.lists() })
		},
	})
}

/**
 * Decline an invitation
 */
export function useDeclineInvitation() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (invitationId: string) => api.declineInvitation(invitationId),
		onSuccess: () => {
			// Invalidate invitations
			void queryClient.invalidateQueries({ queryKey: groupKeys.invitations() })
		},
	})
}

/**
 * Redeem an invite code
 */
export function useRedeemInviteCode() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (code: string) => api.redeemInviteCode(code),
		onSuccess: () => {
			// Invalidate user memberships and group lists
			void queryClient.invalidateQueries({ queryKey: groupKeys.userMemberships() })
			void queryClient.invalidateQueries({ queryKey: groupKeys.lists() })
		},
	})
}

/**
 * Search for characters by name (for autocomplete)
 */
export function useSearchCharacters(query: string, enabled = true) {
	return useQuery({
		queryKey: groupKeys.characterSearch(query),
		queryFn: () => api.searchCharacters(query),
		enabled: enabled && query.length >= 2,
		staleTime: 1000 * 60 * 5, // 5 minutes
	})
}

/**
 * Get all pending invitations for a group (admin only)
 */
export function useGroupInvitations(groupId: string) {
	return useQuery({
		queryKey: groupKeys.groupInvitations(groupId),
		queryFn: () => api.getGroupInvitations(groupId),
		enabled: !!groupId,
	})
}

/**
 * Create a direct invitation by character name (admin only)
 */
export function useCreateInvitation() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({ groupId, characterName }: { groupId: string; characterName: string }) =>
			api.createInvitation(groupId, characterName),
		onSuccess: (_, { groupId }) => {
			// Invalidate group invitations list
			void queryClient.invalidateQueries({ queryKey: groupKeys.groupInvitations(groupId) })
			// Also invalidate member list in case they accept immediately
			void queryClient.invalidateQueries({ queryKey: groupKeys.detail(groupId) })
		},
	})
}

/**
 * Transfer group ownership (owner or admin only)
 */
export function useTransferOwnership() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({ groupId, newOwnerId }: { groupId: string; newOwnerId: string }) =>
			api.transferGroupOwnership(groupId, newOwnerId),
		onSuccess: (_, { groupId }) => {
			// Invalidate group details (ownership changed)
			void queryClient.invalidateQueries({ queryKey: groupKeys.detail(groupId) })
			// Invalidate all group lists (ownership affects display)
			void queryClient.invalidateQueries({ queryKey: groupKeys.lists() })
			// Invalidate user memberships (old owner now has different role)
			void queryClient.invalidateQueries({ queryKey: groupKeys.userMemberships() })
		},
	})
}
