import { useQuery } from '@tanstack/react-query'

import { apiClient } from '@/lib/api'

import type { FulcrumCharacterData } from '@/features/applications/api'

export interface AuditorUsersFilters {
	search?: string
	limit?: number
	offset?: number
}

export interface AuditorUserSummary {
	id: string
	mainCharacterId: string
	mainCharacterName: string | null
	characterCount: number
	is_admin: boolean
	discordUserId: string | null
	discordUsername: string | null
	matchedCharacterId: string | null
	matchedCharacterName: string | null
	createdAt: string
	updatedAt: string
}

export interface AuditorUsersResult {
	users: AuditorUserSummary[]
	total: number
	limit: number
	offset: number
}

export interface AuditorUserDetails {
	id: string
	mainCharacterId: string
	is_admin: boolean
	discordUserId: string | null
	characters: Array<{
		characterId: string
		characterName: string
		is_primary: boolean
		hasValidToken: boolean
	}>
	groupMemberships: Array<{
		groupId: string
		groupName: string
		membershipLevel: 'member' | 'admin' | 'owner'
		joinedAt: string
	}>
	createdAt: string
	updatedAt: string
}

export const auditorUserKeys = {
	all: ['hr', 'auditor', 'users'] as const,
	lists: () => [...auditorUserKeys.all, 'list'] as const,
	list: (filters?: AuditorUsersFilters) => [...auditorUserKeys.lists(), filters] as const,
	details: () => [...auditorUserKeys.all, 'detail'] as const,
	detail: (userId: string) => [...auditorUserKeys.details(), userId] as const,
	fulcrum: (userId: string) => [...auditorUserKeys.detail(userId), 'fulcrum'] as const,
	ipHistory: (userId: string) => [...auditorUserKeys.detail(userId), 'ip-history'] as const,
	ipHashMatches: (ipAddressHash: string) =>
		[...auditorUserKeys.all, 'ip-history', ipAddressHash, 'matches'] as const,
}

/**
 * Search users via the HR auditor endpoint (requires urn:hr:auditor or admin)
 */
export function useAuditorUsers(filters?: AuditorUsersFilters) {
	return useQuery<AuditorUsersResult>({
		queryKey: auditorUserKeys.list(filters),
		queryFn: async () => {
			const params = new URLSearchParams()
			if (filters?.search) params.set('search', filters.search)
			if (filters?.limit !== undefined) params.set('limit', String(filters.limit))
			if (filters?.offset !== undefined) params.set('offset', String(filters.offset))
			const qs = params.toString()
			return apiClient.get(`/hr/audit/users${qs ? `?${qs}` : ''}`)
		},
		staleTime: 1000 * 60 * 2,
		gcTime: 1000 * 60 * 5,
	})
}

/**
 * Get detailed user info via the HR auditor endpoint
 */
export function useAuditorUser(userId: string) {
	return useQuery<AuditorUserDetails>({
		queryKey: auditorUserKeys.detail(userId),
		queryFn: () => apiClient.get(`/hr/audit/users/${userId}`),
		enabled: !!userId,
		staleTime: 1000 * 60 * 2,
		gcTime: 1000 * 60 * 5,
	})
}

export function useAuditorUserIpHistory(userId: string) {
	return useQuery({
		queryKey: auditorUserKeys.ipHistory(userId),
		queryFn: () => apiClient.getHrAuditorUserIpHistory(userId),
		enabled: !!userId,
		staleTime: 1000 * 60 * 2,
	})
}

export function useAuditorIpHashMatches(ipAddressHash: string | null) {
	return useQuery({
		queryKey: auditorUserKeys.ipHashMatches(ipAddressHash ?? ''),
		queryFn: () => apiClient.getHrAuditorIpHashMatches(ipAddressHash ?? ''),
		enabled: !!ipAddressHash,
		staleTime: 1000 * 60,
	})
}

/**
 * Get all characters with Fulcrum reports for a user — no corporationId required (auditor bypass)
 */
export function useAuditorFulcrum(userId: string, enabled = true) {
	return useQuery<FulcrumCharacterData[]>({
		queryKey: auditorUserKeys.fulcrum(userId),
		queryFn: () => apiClient.get(`/fulcrum/users/${userId}/characters`),
		enabled: !!userId && enabled,
		staleTime: 1000 * 30,
		gcTime: 1000 * 60 * 3,
		refetchInterval: (query) => {
			const data = query.state.data
			const hasInProgress = data?.some((ch) =>
				ch.reports.some((r) => r.status === 'pending' || r.status === 'processing')
			)
			return hasInProgress ? 10_000 : false
		},
	})
}
