import { useQuery, useQueryClient } from '@tanstack/react-query'

import { useApiMutation } from '@/hooks/useApiMutation'

import {
	createDeposit,
	createMarket,
	getAuditLedger,
	getMarketHistory,
	getMarkets,
	getUserLedger,
	getWallet,
	getWallets,
} from './api'
import { pmKeys } from './query-keys'

import type {
	AuditLedgerFilters,
	CreateMarketRequest,
	DepositRequest,
	LedgerFilters,
	MarketHistoryFilters,
	MarketsFilters,
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

export function useMarkets(filters?: MarketsFilters) {
	return useQuery({
		queryKey: pmKeys.markets(filters),
		queryFn: () => getMarkets(filters),
		staleTime: STALE_TIME,
		gcTime: GC_TIME,
	})
}

/**
 * POST /markets — creates the market + best-effort forum post. Toasts on success (noting
 * a `postError` if the post failed), invalidates the markets list.
 */
export function useCreateMarket() {
	const queryClient = useQueryClient()

	return useApiMutation({
		mutationFn: (body: CreateMarketRequest) => createMarket(body),
		successMessage: (res) =>
			res.postError
				? `Market created, but the forum post failed: ${res.postError}`
				: 'Market created and posted to the forum.',
		onSuccess: () => {
			// Broad key so every markets-list variant (any filter) refetches.
			queryClient.invalidateQueries({ queryKey: [...pmKeys.all, 'markets'] })
		},
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
