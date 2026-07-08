/**
 * Query key factory for Prediction Markets admin queries.
 */

import type {
	AuditLedgerFilters,
	LedgerFilters,
	MarketHistoryFilters,
	MarketsFilters,
	WalletsFilters,
} from './types'

export const pmKeys = {
	all: ['prediction-markets'] as const,
	wallets: (filters?: WalletsFilters) => [...pmKeys.all, 'wallets', filters] as const,
	wallet: (userId: string) => [...pmKeys.all, 'wallet', userId] as const,
	userLedger: (userId: string, filters?: LedgerFilters) =>
		[...pmKeys.all, 'userLedger', userId, filters] as const,
	auditLedger: (filters?: AuditLedgerFilters) => [...pmKeys.all, 'auditLedger', filters] as const,
	marketHistory: (filters?: MarketHistoryFilters) =>
		[...pmKeys.all, 'marketHistory', filters] as const,
	markets: (filters?: MarketsFilters) => [...pmKeys.all, 'markets', filters] as const,
	config: () => [...pmKeys.all, 'config'] as const,
}
