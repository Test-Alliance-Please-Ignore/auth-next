import { useMutation, useQuery } from '@tanstack/react-query'

import { freightApi } from '@/lib/freight-api'
import toast from '@/lib/toast'

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
 * Open a courier contract in the player's running EVE client.
 * Surfaces success / failure (e.g. client offline, re-link needed) as toasts.
 */
export function useOpenContractInGame() {
    return useMutation({
        mutationFn: (contractId: string) => freightApi.openContractInGame(contractId),
        onSuccess: (result) => {
            toast.success(`Opening contract in ${result.characterName}'s client`)
        },
        onError: (err) => {
            toast.error(
                err instanceof Error
                    ? err.message
                    : 'Could not open the contract in-game'
            )
        },
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
