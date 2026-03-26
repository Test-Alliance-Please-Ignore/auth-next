import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '@/lib/api'

import type {
	AdminActivityLogFilters,
	AdminDiscordAccessInspection,
	AdminUser,
	AdminUserDetail,
	AdminUsersFilters,
	PaginatedResponse,
} from '@/lib/api'

// Query keys
export const adminUserKeys = {
	all: ['admin', 'users'] as const,
	lists: () => [...adminUserKeys.all, 'list'] as const,
	list: (filters?: AdminUsersFilters) => [...adminUserKeys.lists(), filters] as const,
	details: () => [...adminUserKeys.all, 'detail'] as const,
	detail: (userId: string) => [...adminUserKeys.details(), userId] as const,
	discordInspection: (userId: string) =>
		[...adminUserKeys.detail(userId), 'discord-inspection'] as const,
	activityLogs: () => ['admin', 'activity-logs'] as const,
	activityLog: (filters?: AdminActivityLogFilters) =>
		[...adminUserKeys.activityLogs(), filters] as const,
}

// Queries

/**
 * Fetch paginated list of users with optional filters
 */
export function useAdminUsers(filters?: AdminUsersFilters) {
	return useQuery({
		queryKey: adminUserKeys.list(filters),
		queryFn: () => api.getAdminUsers(filters),
		staleTime: 1000 * 60 * 2, // 2 minutes
		gcTime: 1000 * 60 * 10, // Keep in cache for 10 minutes
	})
}

/**
 * Fetch detailed information about a specific user
 */
export function useAdminUser(userId: string) {
	return useQuery({
		queryKey: adminUserKeys.detail(userId),
		queryFn: () => api.getAdminUser(userId),
		enabled: !!userId,
		staleTime: 1000 * 60 * 2, // 2 minutes
	})
}

/**
 * Fetch Discord access inspection details for a specific user (on-demand)
 */
export function useAdminDiscordInspection(userId: string, enabled: boolean) {
	return useQuery<AdminDiscordAccessInspection>({
		queryKey: adminUserKeys.discordInspection(userId),
		queryFn: () => api.inspectDiscordAccess(userId),
		enabled: !!userId && enabled,
		staleTime: 1000 * 30, // 30 seconds
	})
}

/**
 * Fetch activity logs with optional filters
 */
export function useActivityLogs(filters?: AdminActivityLogFilters) {
	return useQuery({
		queryKey: adminUserKeys.activityLog(filters),
		queryFn: () => api.getActivityLogs(filters),
		staleTime: 1000 * 60 * 1, // 1 minute
		gcTime: 1000 * 60 * 5, // Keep in cache for 5 minutes
	})
}

// Mutations

/**
 * Toggle admin status for a user
 */
export function useSetUserAdmin() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({ userId, isAdmin }: { userId: string; isAdmin: boolean }) =>
			api.setUserAdmin(userId, isAdmin),
		onSuccess: (_, { userId, isAdmin }) => {
			// Invalidate user lists
			void queryClient.invalidateQueries({ queryKey: adminUserKeys.lists() })

			// Update user detail cache
			queryClient.setQueryData(adminUserKeys.detail(userId), (old: AdminUserDetail | undefined) => {
				if (!old) return old
				return { ...old, is_admin: isAdmin }
			})

			// Update user in list cache
			queryClient.setQueriesData<PaginatedResponse<AdminUser>>(
				{ queryKey: adminUserKeys.lists() },
				(old) => {
					if (!old) return old
					return {
						...old,
						data: old.data.map((user) =>
							user.id === userId ? { ...user, is_admin: isAdmin } : user
						),
					}
				}
			)
		},
	})
}

/**
 * Revoke a user's Discord authorization
 */
export function useRevokeDiscordLink() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (userId: string) => api.revokeDiscordLink(userId),
		onSuccess: (_, userId) => {
			// Invalidate user detail to refetch Discord status
			void queryClient.invalidateQueries({ queryKey: adminUserKeys.detail(userId) })
		},
	})
}

/**
 * Completely unlink a user's Discord account (admin action)
 */
export function useUnlinkDiscordAccount() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (userId: string) => api.unlinkDiscordAccount(userId),
		onSuccess: (_, userId) => {
			// Invalidate user detail to refetch Discord status
			void queryClient.invalidateQueries({ queryKey: adminUserKeys.detail(userId) })
		},
	})
}

/**
 * Clear all active sessions for a user (admin action)
 */
export function useClearUserSessions() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (userId: string) => api.clearUserSessions(userId),
		onSuccess: (_, userId) => {
			// Invalidate user detail to refetch activity logs
			void queryClient.invalidateQueries({ queryKey: adminUserKeys.detail(userId) })
		},
	})
}

/**
 * Trigger user sync workflow (admin action)
 * Bypasses the 5-minute throttle for immediate sync
 */
export function useSyncUser() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (userId: string) => api.syncUser(userId),
		onSuccess: (_, userId) => {
			// Invalidate user detail to reflect any changes after sync completes
			void queryClient.invalidateQueries({ queryKey: adminUserKeys.detail(userId) })
			// Also invalidate user lists in case character data changed
			void queryClient.invalidateQueries({ queryKey: adminUserKeys.lists() })
		},
	})
}

/**
 * Update a user's Discord access - joins them to all eligible Discord servers
 * with appropriate roles based on corporation and group memberships
 */
export function useUpdateDiscordAccess() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (userId: string) => api.triggerDiscordJoin(userId),
		onSuccess: (_, userId) => {
			// Invalidate user detail to refetch Discord status
			void queryClient.invalidateQueries({ queryKey: adminUserKeys.detail(userId) })
		},
	})
}

/**
 * Delete a character from a user account
 */
export function useDeleteUserCharacter() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({ userId, characterId }: { userId: string; characterId: string }) =>
			api.deleteUserCharacter(userId, characterId),
		onSuccess: (_, { userId, characterId }) => {
			// Invalidate user lists
			void queryClient.invalidateQueries({ queryKey: adminUserKeys.lists() })

			// Update user detail cache
			queryClient.setQueryData(adminUserKeys.detail(userId), (old: AdminUserDetail | undefined) => {
				if (!old) return old
				return {
					...old,
					characters: old.characters.filter((char) => char.characterId !== characterId),
				}
			})

			// Invalidate user in list cache to refetch
			void queryClient.invalidateQueries({ queryKey: adminUserKeys.detail(userId) })
		},
	})
}

/**
 * Set a character as the primary character for a user
 */
export function useSetUserPrimaryCharacter() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({ userId, characterId }: { userId: string; characterId: string }) =>
			api.setUserPrimaryCharacter(userId, characterId),
		onSuccess: (_, { userId, characterId }) => {
			// Invalidate user lists
			void queryClient.invalidateQueries({ queryKey: adminUserKeys.lists() })

			// Update user detail cache optimistically
			queryClient.setQueryData(adminUserKeys.detail(userId), (old: AdminUserDetail | undefined) => {
				if (!old) return old
				return {
					...old,
					mainCharacterId: characterId,
					characters: old.characters.map((char) => ({
						...char,
						is_primary: char.characterId === characterId,
					})),
				}
			})

			// Invalidate to refetch and ensure consistency
			void queryClient.invalidateQueries({ queryKey: adminUserKeys.detail(userId) })
		},
	})
}
