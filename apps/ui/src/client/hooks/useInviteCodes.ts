import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { apiClient } from '@/lib/api'

import type { GroupInviteCode } from '@/lib/api'

// Query keys
export const inviteCodeKeys = {
	all: ['invite-codes'] as const,
	group: (groupId: string) => ['groups', groupId, 'invite-codes'] as const,
}

/**
 * Fetch invite codes for a group
 */
export function useGroupInviteCodes(groupId: string, enabled = true) {
	return useQuery({
		queryKey: inviteCodeKeys.group(groupId),
		queryFn: () => apiClient.getGroupInviteCodes(groupId),
		staleTime: 1000 * 30, // 30 seconds
		gcTime: 1000 * 60 * 5, // Keep in cache for 5 minutes
		enabled: !!groupId && enabled,
	})
}

/**
 * Create a new invite code for a group
 */
export function useCreateInviteCode() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({
			groupId,
			maxUses,
			expiresInDays,
		}: {
			groupId: string
			maxUses?: number | null
			expiresInDays?: number
		}) => apiClient.createGroupInviteCode(groupId, { maxUses, expiresInDays }),
		onSuccess: (_, { groupId }) => {
			void queryClient.invalidateQueries({
				queryKey: inviteCodeKeys.group(groupId),
				refetchType: 'active',
			})
		},
	})
}

/**
 * Revoke an invite code
 */
export function useRevokeInviteCode() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({ codeId }: { codeId: string; groupId: string }) =>
			apiClient.revokeGroupInviteCode(codeId),
		onMutate: async ({ codeId, groupId }) => {
			await queryClient.cancelQueries({ queryKey: inviteCodeKeys.group(groupId) })
			const previousInviteCodes = queryClient.getQueryData<GroupInviteCode[]>(
				inviteCodeKeys.group(groupId)
			)
			queryClient.setQueryData<GroupInviteCode[]>(inviteCodeKeys.group(groupId), (current = []) =>
				current.map((inviteCode) =>
					inviteCode.id === codeId
						? { ...inviteCode, revokedAt: new Date().toISOString() }
						: inviteCode
				)
			)
			return { previousInviteCodes, groupId }
		},
		onError: (_error, _variables, context) => {
			if (!context) return
			queryClient.setQueryData(inviteCodeKeys.group(context.groupId), context.previousInviteCodes)
		},
		onSuccess: (_, { groupId }) => {
			void queryClient.invalidateQueries({
				queryKey: inviteCodeKeys.group(groupId),
				refetchType: 'active',
			})
		},
	})
}
