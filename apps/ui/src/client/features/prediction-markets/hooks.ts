import { useQuery, useQueryClient } from '@tanstack/react-query'

import { useApiMutation } from '@/hooks/useApiMutation'

import {
	createDeposit,
	getAuditLedger,
	getMarketHistory,
	getUserLedger,
	getWallet,
	getWallets,
} from './api'
import { pmKeys } from './query-keys'

import type {
	AuditLedgerFilters,
	DepositRequest,
	LedgerFilters,
	MarketHistoryFilters,
	WalletsFilters,
} from './types'

const STALE_TIME = 1000 * 60 * 2 // 2 minutes
const GC_TIME = 1000 * 60 * 5 // 5 minutes

export function useWallets(filters?: WalletsFilters) {
	return useQuery({
		queryKey: pmKeys.wallets(filters),
		queryFn: () => getWallets(filters),
		staleTime: STALE_TIME,
		gcTime: GC_TIME,
	})
}

export function useWallet(userId: string) {
	return useQuery({
		queryKey: pmKeys.wallet(userId),
		queryFn: () => getWallet(userId),
		enabled: !!userId,
		staleTime: STALE_TIME,
		gcTime: GC_TIME,
	})
}

export function useUserLedger(userId: string, filters?: LedgerFilters) {
	return useQuery({
		queryKey: pmKeys.userLedger(userId, filters),
		queryFn: () => getUserLedger(userId, filters),
		enabled: !!userId,
		staleTime: STALE_TIME,
		gcTime: GC_TIME,
	})
}

export function useAuditLedger(filters?: AuditLedgerFilters) {
	return useQuery({
		queryKey: pmKeys.auditLedger(filters),
		queryFn: () => getAuditLedger(filters),
		staleTime: STALE_TIME,
		gcTime: GC_TIME,
	})
}

export function useMarketHistory(filters?: MarketHistoryFilters) {
	return useQuery({
		queryKey: pmKeys.marketHistory(filters),
		queryFn: () => getMarketHistory(filters),
		staleTime: STALE_TIME,
		gcTime: GC_TIME,
	})
}

/** POST /deposits — toasts on success/error; invalidates all PM queries + the target wallet. */
export function useDeposit() {
	const queryClient = useQueryClient()

	return useApiMutation({
		mutationFn: (body: DepositRequest) => createDeposit(body),
		successMessage: (res) =>
			res.deduped ? 'Deposit already applied (idempotent).' : 'Deposit successful.',
		onSuccess: (_res, variables) => {
			queryClient.invalidateQueries({ queryKey: pmKeys.all })
			queryClient.invalidateQueries({ queryKey: pmKeys.wallet(variables.targetUserId) })
		},
	})
}
