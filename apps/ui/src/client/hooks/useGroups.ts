import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type {
	CreateGroupRequest,
	CreateJoinRequestRequest,
	Group,
	GroupJoinRequest,
	GroupInvitationWithDetails,
	GroupMembershipSummary,
	GroupWithDetails,
	GroupsFilters,
	RedeemInviteCodeResponse,
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
	joinRequests: (groupId: string) => ['groups', groupId, 'join-requests'] as const,
}

// Queries

/**
 * Fetch groups with optional filters
 */
export function useGroups(filters?: GroupsFilters) {
	return useQuery({
		queryKey: groupKeys.list(filters),
		queryFn: () => api.getGroups(filters),
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
		onSuccess: (newGroup) => {
			// Invalidate all group lists (they may have different filters)
			queryClient.invalidateQueries({ queryKey: groupKeys.lists() })

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
			queryClient.invalidateQueries({ queryKey: groupKeys.lists() })

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
			queryClient.invalidateQueries({ queryKey: groupKeys.lists() })

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
			queryClient.invalidateQueries({ queryKey: groupKeys.lists() })
			queryClient.invalidateQueries({ queryKey: groupKeys.userMemberships() })
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
			queryClient.invalidateQueries({ queryKey: groupKeys.lists() })
			queryClient.invalidateQueries({ queryKey: groupKeys.userMemberships() })
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
			queryClient.invalidateQueries({ queryKey: groupKeys.details() })
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
			queryClient.invalidateQueries({ queryKey: ['groups'] })
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
			queryClient.invalidateQueries({ queryKey: ['groups'] })
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
			queryClient.invalidateQueries({ queryKey: groupKeys.invitations() })
			queryClient.invalidateQueries({ queryKey: groupKeys.userMemberships() })
			queryClient.invalidateQueries({ queryKey: groupKeys.lists() })
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
			queryClient.invalidateQueries({ queryKey: groupKeys.invitations() })
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
			queryClient.invalidateQueries({ queryKey: groupKeys.userMemberships() })
			queryClient.invalidateQueries({ queryKey: groupKeys.lists() })
		},
	})
}
