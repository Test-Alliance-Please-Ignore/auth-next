import { useQuery } from '@tanstack/react-query'

import { freightApi } from '@/lib/freight-api'

export const freightContractKeys = {
    all: ['freight-contracts'] as const,
    lists: () => [...freightContractKeys.all, 'list'] as const,
    list: (filters?: { status?: string }) => [...freightContractKeys.lists(), filters] as const,
    leaderboard: () => [...freightContractKeys.all, 'leaderboard'] as const,
}

/**
 * Fetch alliance courier contracts with optional status filter
 */
export function useFreightContracts(filters?: { status?: string }) {
    return useQuery({
        queryKey: freightContractKeys.list(filters),
        queryFn: () => freightApi.listContracts(filters),
        staleTime: 1000 * 60, // 1 minute
    })
}

/**
 * Fetch courier contract leaderboard
 */
export function useFreightLeaderboard(period?: '30d' | 'all') {
    return useQuery({
        queryKey: [...freightContractKeys.leaderboard(), period],
        queryFn: () => freightApi.getLeaderboard(period),
        staleTime: 1000 * 60 * 5, // 5 minutes
    })
}
