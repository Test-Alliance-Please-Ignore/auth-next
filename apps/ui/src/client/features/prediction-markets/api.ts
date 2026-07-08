/**
 * Prediction Markets (admin) API client methods.
 *
 * Base path: /admin/prediction-markets (the shared apiClient prepends /api).
 * apiClient returns the parsed JSON body directly (no `.data` unwrap); the L1
 * endpoints already return `{ rows, total }`, so type calls as `Paged<T>`.
 */

import { apiClient } from '@/lib/api'

import type {
	AdminLedgerRow,
	AdminMarketHistoryRow,
	AdminWalletRow,
	AuditLedgerFilters,
	CreateMarketRequest,
	CreateMarketResponse,
	DepositRequest,
	DepositResponse,
	LedgerFilters,
	MarketHistoryFilters,
	MarketsFilters,
	MarketsResponse,
	Paged,
	UpdateMarketRequest,
	UpdateMarketResponse,
	WalletDetail,
	WalletsFilters,
} from './types'

const BASE = '/admin/prediction-markets'

/** GET /wallets — paginated wallet list with name search + sort. */
export async function getWallets(filters?: WalletsFilters): Promise<Paged<AdminWalletRow>> {
	const params = new URLSearchParams()
	if (filters?.search) params.set('search', filters.search)
	if (filters?.sort) params.set('sort', filters.sort)
	if (filters?.order) params.set('order', filters.order)
	if (filters?.limit !== undefined) params.set('limit', String(filters.limit))
	if (filters?.offset !== undefined) params.set('offset', String(filters.offset))

	const query = params.toString()
	return apiClient.get<Paged<AdminWalletRow>>(`${BASE}/wallets${query ? `?${query}` : ''}`)
}

/** GET /wallets/:userId — single wallet detail. */
export async function getWallet(userId: string): Promise<WalletDetail> {
	return apiClient.get<WalletDetail>(`${BASE}/wallets/${userId}`)
}

/** GET /wallets/:userId/ledger — one user's ledger. */
export async function getUserLedger(
	userId: string,
	filters?: LedgerFilters
): Promise<Paged<AdminLedgerRow>> {
	const params = new URLSearchParams()
	if (filters?.limit !== undefined) params.set('limit', String(filters.limit))
	if (filters?.offset !== undefined) params.set('offset', String(filters.offset))

	const query = params.toString()
	return apiClient.get<Paged<AdminLedgerRow>>(
		`${BASE}/wallets/${userId}/ledger${query ? `?${query}` : ''}`
	)
}

/** GET /audit/ledger — global ledger with filters. */
export async function getAuditLedger(filters?: AuditLedgerFilters): Promise<Paged<AdminLedgerRow>> {
	const params = new URLSearchParams()
	if (filters?.userId) params.set('userId', filters.userId)
	if (filters?.type) params.set('type', filters.type)
	if (filters?.marketId) params.set('marketId', filters.marketId)
	if (filters?.since) params.set('since', filters.since)
	if (filters?.until) params.set('until', filters.until)
	if (filters?.limit !== undefined) params.set('limit', String(filters.limit))
	if (filters?.offset !== undefined) params.set('offset', String(filters.offset))

	const query = params.toString()
	return apiClient.get<Paged<AdminLedgerRow>>(`${BASE}/audit/ledger${query ? `?${query}` : ''}`)
}

/** GET /audit/market-history — market lifecycle audit feed. */
export async function getMarketHistory(
	filters?: MarketHistoryFilters
): Promise<Paged<AdminMarketHistoryRow>> {
	const params = new URLSearchParams()
	if (filters?.marketId) params.set('marketId', filters.marketId)
	if (filters?.includeInternal !== undefined)
		params.set('includeInternal', String(filters.includeInternal))
	if (filters?.since) params.set('since', filters.since)
	if (filters?.until) params.set('until', filters.until)
	if (filters?.limit !== undefined) params.set('limit', String(filters.limit))
	if (filters?.offset !== undefined) params.set('offset', String(filters.offset))

	const query = params.toString()
	return apiClient.get<Paged<AdminMarketHistoryRow>>(
		`${BASE}/audit/market-history${query ? `?${query}` : ''}`
	)
}

/** POST /deposits — credit a wallet. 400 self/validation, 409 idempotency-conflict. */
export async function createDeposit(body: DepositRequest): Promise<DepositResponse> {
	return apiClient.post<DepositResponse>(`${BASE}/deposits`, body)
}

/** GET /markets — recent markets + the configured guild id (for forum links). */
export async function getMarkets(filters?: MarketsFilters): Promise<MarketsResponse> {
	const params = new URLSearchParams()
	if (filters?.status) params.set('status', filters.status)
	if (filters?.limit !== undefined) params.set('limit', String(filters.limit))
	const query = params.toString()
	return apiClient.get<MarketsResponse>(`${BASE}/markets${query ? `?${query}` : ''}`)
}

/** POST /markets — create a market; the bot best-effort publishes its forum post. */
export async function createMarket(body: CreateMarketRequest): Promise<CreateMarketResponse> {
	return apiClient.post<CreateMarketResponse>(`${BASE}/markets`, body)
}

/** PATCH /markets/:id — edit a market's safe fields; the bot refreshes + announces the change. */
export async function updateMarket(
	id: string,
	body: UpdateMarketRequest
): Promise<UpdateMarketResponse> {
	return apiClient.patch<UpdateMarketResponse>(`${BASE}/markets/${id}`, body)
}

/**
 * Member (non-admin) create — the /api/prediction-markets router, gated on urn:markets:creator.
 * Same request/response shape as the admin create; different endpoint + permission.
 */
export async function createMarketAsMember(
	body: CreateMarketRequest
): Promise<CreateMarketResponse> {
	return apiClient.post<CreateMarketResponse>('/prediction-markets/markets', body)
}
