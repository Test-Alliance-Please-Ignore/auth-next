/**
 * DKP API Client
 *
 * API client methods for DKP operations
 */

import { apiClient } from '@/lib/api'
import type {
	AwardDkpRequest,
	AwardDkpResponse,
	BulkAwardDkpRequest,
	BulkAwardDkpResponse,
	DkpCharacterBalance,
	DkpCharacterLeaderboardEntry,
	DkpCorporationBalance,
	DkpCorporationLeaderboardEntry,
	DkpFilters,
	DkpLeaderboardResponse,
	DkpStatistics,
	DkpTransactionHistoryResponse,
	DkpUserBalance,
	DkpUserLeaderboardEntry,
	LeaderboardFilters,
} from './types'

/**
 * Award DKP to a single character
 */
export async function awardDkp(request: AwardDkpRequest): Promise<AwardDkpResponse> {
	return apiClient.post('/dkp/award-manual', request)
}

/**
 * Award DKP to multiple characters at once
 */
export async function awardDkpBulk(request: BulkAwardDkpRequest): Promise<BulkAwardDkpResponse> {
	return apiClient.post('/dkp/award-bulk', request)
}

/**
 * Get user DKP balance
 */
export async function getUserBalance(userId: string, period?: string): Promise<DkpUserBalance> {
	const params = period ? `?period=${period}` : ''
	return apiClient.get(`/dkp/balance/user/${userId}${params}`)
}

/**
 * Get character DKP balance
 */
export async function getCharacterBalance(
	characterId: string,
	period?: string
): Promise<DkpCharacterBalance> {
	const params = period ? `?period=${period}` : ''
	return apiClient.get(`/dkp/balance/${characterId}${params}`)
}

/**
 * Get corporation DKP balance
 */
export async function getCorporationBalance(
	corporationId: string,
	period?: string
): Promise<DkpCorporationBalance> {
	const params = period ? `?period=${period}` : ''
	return apiClient.get(`/dkp/balance/corporation/${corporationId}${params}`)
}

/**
 * Get user leaderboard
 */
export async function getUserLeaderboard(
	filters?: LeaderboardFilters
): Promise<DkpLeaderboardResponse<DkpUserLeaderboardEntry>> {
	const params = new URLSearchParams()
	if (filters?.period) params.set('period', filters.period)
	if (filters?.limit !== undefined) params.set('limit', String(filters.limit))
	if (filters?.offset !== undefined) params.set('offset', String(filters.offset))

	const query = params.toString()
	return apiClient.get(`/dkp/leaderboard/users${query ? `?${query}` : ''}`)
}

/**
 * Get character leaderboard
 */
export async function getCharacterLeaderboard(
	filters?: LeaderboardFilters
): Promise<DkpLeaderboardResponse<DkpCharacterLeaderboardEntry>> {
	const params = new URLSearchParams()
	if (filters?.period) params.set('period', filters.period)
	if (filters?.corporationId) params.set('corporationId', filters.corporationId)
	if (filters?.limit !== undefined) params.set('limit', String(filters.limit))
	if (filters?.offset !== undefined) params.set('offset', String(filters.offset))

	const query = params.toString()
	return apiClient.get(`/dkp/leaderboard/characters${query ? `?${query}` : ''}`)
}

/**
 * Get corporation leaderboard
 */
export async function getCorporationLeaderboard(
	filters?: LeaderboardFilters
): Promise<DkpLeaderboardResponse<DkpCorporationLeaderboardEntry>> {
	const params = new URLSearchParams()
	if (filters?.period) params.set('period', filters.period)
	if (filters?.limit !== undefined) params.set('limit', String(filters.limit))
	if (filters?.offset !== undefined) params.set('offset', String(filters.offset))

	const query = params.toString()
	return apiClient.get(`/dkp/leaderboard/corporations${query ? `?${query}` : ''}`)
}

/**
 * Get transaction history
 */
export async function getTransactionHistory(
	filters?: DkpFilters
): Promise<DkpTransactionHistoryResponse> {
	const params = new URLSearchParams()
	if (filters?.userId) params.set('userId', filters.userId)
	if (filters?.characterId) params.set('characterId', filters.characterId)
	if (filters?.corporationId) params.set('corporationId', filters.corporationId)
	if (filters?.sourceType) params.set('sourceType', filters.sourceType)
	if (filters?.startDate) params.set('startDate', filters.startDate)
	if (filters?.endDate) params.set('endDate', filters.endDate)
	if (filters?.limit !== undefined) params.set('limit', String(filters.limit))
	if (filters?.offset !== undefined) params.set('offset', String(filters.offset))

	const query = params.toString()
	return apiClient.get(`/dkp/transactions${query ? `?${query}` : ''}`)
}

/**
 * Get admin statistics
 */
export async function getDkpStatistics(): Promise<DkpStatistics> {
	return apiClient.get('/dkp/admin/statistics')
}
