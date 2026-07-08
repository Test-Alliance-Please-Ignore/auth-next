import { useQuery, useQueryClient } from '@tanstack/react-query'

import { useApiMutation } from '@/hooks/useApiMutation'

import {
	createDeposit,
	createMarket,
	createMarketAsMember,
	getAuditLedger,
	getConfig,
	getMarketHistory,
	getMarkets,
	getUserLedger,
	getWallet,
	getWallets,
	updateConfig,
	updateMarket,
} from './api'
import { pmKeys } from './query-keys'

import type {
	AuditLedgerFilters,
	CreateMarketRequest,
	DepositRequest,
	LedgerFilters,
	MarketHistoryFilters,
	MarketsFilters,
	UpdateConfigRequest,
	UpdateMarketRequest,
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
export function useCreateMarket(scope: 'admin' | 'member' = 'admin') {
	const queryClient = useQueryClient()
	const submit = scope === 'member' ? createMarketAsMember : createMarket

	return useApiMutation({
		mutationFn: (body: CreateMarketRequest) => submit(body),
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

/**
 * PATCH /markets/:id — edit a market's safe fields; the bot refreshes the forum post + announces
 * the change. Toasts on success, invalidates the markets list.
 */
export function useUpdateMarket() {
	const queryClient = useQueryClient()

	return useApiMutation({
		mutationFn: ({ id, body }: { id: string; body: UpdateMarketRequest }) => updateMarket(id, body),
		successMessage: 'Market updated.',
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: [...pmKeys.all, 'markets'] })
		},
	})
}

/** GET /config — the active config defaults. */
export function useConfig() {
	return useQuery({
		queryKey: pmKeys.config(),
		queryFn: getConfig,
		staleTime: STALE_TIME,
		gcTime: GC_TIME,
	})
}

/** PATCH /config — full-replace the active config; toasts on success, invalidates the config query. */
export function useUpdateConfig() {
	const queryClient = useQueryClient()

	return useApiMutation({
		mutationFn: (body: UpdateConfigRequest) => updateConfig(body),
		successMessage: 'Configuration updated.',
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: pmKeys.config() })
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
