import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
	awardDkp,
	awardDkpBulk,
	getCharacterBalance,
	getCharacterLeaderboard,
	getCorporationBalance,
	getCorporationLeaderboard,
	getDkpStatistics,
	getTransactionHistory,
	getUserBalance,
	getUserLeaderboard,
} from './api'

import type { AwardDkpRequest, BulkAwardDkpRequest, DkpFilters, LeaderboardFilters } from './types'

/**
 * DKP React Query Hooks
 *
 * Custom hooks for DKP data fetching and mutations
 */

/**
 * Query key factory for DKP queries
 * Provides a consistent way to generate query keys
 */
export const dkpKeys = {
	all: ['dkp'] as const,
	statistics: () => [...dkpKeys.all, 'statistics'] as const,
	userBalance: (userId: string, period?: string) =>
		[...dkpKeys.all, 'userBalance', userId, period] as const,
	characterBalance: (characterId: string, period?: string) =>
		[...dkpKeys.all, 'characterBalance', characterId, period] as const,
	corporationBalance: (corporationId: string, period?: string) =>
		[...dkpKeys.all, 'corporationBalance', corporationId, period] as const,
	userLeaderboard: (filters?: LeaderboardFilters) =>
		[...dkpKeys.all, 'userLeaderboard', filters] as const,
	characterLeaderboard: (filters?: LeaderboardFilters) =>
		[...dkpKeys.all, 'characterLeaderboard', filters] as const,
	corporationLeaderboard: (filters?: LeaderboardFilters) =>
		[...dkpKeys.all, 'corporationLeaderboard', filters] as const,
	transactions: (filters?: DkpFilters) => [...dkpKeys.all, 'transactions', filters] as const,
}

/**
 * Hook to fetch DKP statistics for admin dashboard
 */
export function useDkpStatistics() {
	return useQuery({
		queryKey: dkpKeys.statistics(),
		queryFn: getDkpStatistics,
		staleTime: 1000 * 60 * 2, // 2 minutes
		gcTime: 1000 * 60 * 5, // 5 minutes
	})
}

/**
 * Hook to fetch user DKP balance
 */
export function useUserBalance(userId: string, period?: string) {
	return useQuery({
		queryKey: dkpKeys.userBalance(userId, period),
		queryFn: () => getUserBalance(userId, period),
		staleTime: 1000 * 60 * 2,
		gcTime: 1000 * 60 * 5,
	})
}

/**
 * Hook to fetch character DKP balance
 */
export function useCharacterBalance(characterId: string, period?: string) {
	return useQuery({
		queryKey: dkpKeys.characterBalance(characterId, period),
		queryFn: () => getCharacterBalance(characterId, period),
		staleTime: 1000 * 60 * 2,
		gcTime: 1000 * 60 * 5,
	})
}

/**
 * Hook to fetch corporation DKP balance
 */
export function useCorporationBalance(corporationId: string, period?: string) {
	return useQuery({
		queryKey: dkpKeys.corporationBalance(corporationId, period),
		queryFn: () => getCorporationBalance(corporationId, period),
		staleTime: 1000 * 60 * 2,
		gcTime: 1000 * 60 * 5,
	})
}

/**
 * Hook to fetch user leaderboard
 */
export function useUserLeaderboard(filters?: LeaderboardFilters) {
	return useQuery({
		queryKey: dkpKeys.userLeaderboard(filters),
		queryFn: () => getUserLeaderboard(filters),
		staleTime: 1000 * 60 * 2,
		gcTime: 1000 * 60 * 5,
	})
}

/**
 * Hook to fetch character leaderboard
 */
export function useCharacterLeaderboard(filters?: LeaderboardFilters) {
	return useQuery({
		queryKey: dkpKeys.characterLeaderboard(filters),
		queryFn: () => getCharacterLeaderboard(filters),
		staleTime: 1000 * 60 * 2,
		gcTime: 1000 * 60 * 5,
	})
}

/**
 * Hook to fetch corporation leaderboard
 */
export function useCorporationLeaderboard(filters?: LeaderboardFilters) {
	return useQuery({
		queryKey: dkpKeys.corporationLeaderboard(filters),
		queryFn: () => getCorporationLeaderboard(filters),
		staleTime: 1000 * 60 * 2,
		gcTime: 1000 * 60 * 5,
	})
}

/**
 * Hook to fetch transaction history
 */
export function useTransactionHistory(filters?: DkpFilters) {
	return useQuery({
		queryKey: dkpKeys.transactions(filters),
		queryFn: () => getTransactionHistory(filters),
		staleTime: 1000 * 60 * 2,
		gcTime: 1000 * 60 * 5,
	})
}

/**
 * Hook to award DKP to a single character
 */
export function useAwardDkp() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (data: AwardDkpRequest) => awardDkp(data),
		onSuccess: () => {
			// Invalidate all DKP-related queries to refetch updated data
			void queryClient.invalidateQueries({ queryKey: dkpKeys.all })
		},
	})
}

/**
 * Hook to award DKP to multiple characters at once
 */
export function useAwardDkpBulk() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (data: BulkAwardDkpRequest) => awardDkpBulk(data),
		onSuccess: () => {
			// Invalidate all DKP-related queries to refetch updated data
			void queryClient.invalidateQueries({ queryKey: dkpKeys.all })
		},
	})
}
