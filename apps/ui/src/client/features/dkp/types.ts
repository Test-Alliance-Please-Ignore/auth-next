/**
 * DKP Feature Types
 *
 * TypeScript interfaces for DKP-related data structures
 */

export type DkpSourceType = 'fleet' | 'market' | 'mining' | 'manual' | 'adjustment'
export type DkpPeriod = '7d' | '30d' | '90d' | 'all'

export interface DkpBalance {
	current: number
	allTime: number
	last7days: number
	last30days: number
	last90days: number
}

export interface DkpUserBalance {
	userId: string
	balance: DkpBalance
	characterBreakdown: Array<{
		characterId: string
		characterName: string
		corporationId: string
		corporationName: string
		balance: number
	}>
	lastEarned?: {
		characterId: string
		characterName: string
		amount: number
		sourceType: DkpSourceType
		earnedAt: string
	}
}

export interface DkpCharacterBalance {
	characterId: string
	characterName: string
	corporationId: string
	corporationName: string
	balance: DkpBalance
	lastEarned?: {
		amount: number
		sourceType: DkpSourceType
		earnedAt: string
	}
}

export interface DkpCorporationBalance {
	corporationId: string
	corporationName: string
	balance: DkpBalance
	memberCount: number
	topEarners: Array<{
		characterId: string
		characterName: string
		amount: number
	}>
}

export interface DkpTransaction {
	id: string
	characterId: string
	characterName: string
	corporationId: string
	corporationName: string
	amount: number
	sourceType: DkpSourceType
	sourceId?: string
	sourceMetadata?: Record<string, unknown>
	awardedBy?: string
	awardReason?: string
	earnedAt: string
	createdAt: string
}

export interface DkpUserLeaderboardEntry {
	rank: number
	userId: string
	mainCharacterName: string
	balance: number
	characterCount: number
	transactionCount: number
}

export interface DkpCharacterLeaderboardEntry {
	rank: number
	characterId: string
	characterName: string
	corporationId: string
	corporationName: string
	balance: number
	transactionCount: number
}

export interface DkpCorporationLeaderboardEntry {
	rank: number
	corporationId: string
	corporationName: string
	balance: number
	memberCount: number
	transactionCount: number
	averagePerMember: number
}

export interface DkpLeaderboardResponse<T> {
	period: string
	leaderboard: T[]
	pagination: {
		limit: number
		offset: number
		total: number
	}
}

export interface DkpTransactionHistoryResponse {
	transactions: DkpTransaction[]
	pagination: {
		limit: number
		offset: number
		total: number
	}
}

export interface DkpStatistics {
	totals: {
		allTime: number
		last7days: number
		last30days: number
		last90days: number
	}
	breakdown: {
		fleet: number
		market: number
		mining: number
		manual: number
		adjustment: number
	}
	topCharacters: Array<{
		characterId: string
		characterName: string
		amount: number
	}>
	topCorporations: Array<{
		corporationId: string
		corporationName: string
		amount: number
	}>
}

export interface AwardDkpRequest {
	characterId: string
	corporationId?: string
	amount: number
	sourceType: DkpSourceType
	sourceId?: string
	sourceMetadata?: Record<string, unknown>
	awardReason?: string
	earnedAt?: string
}

export interface AwardDkpResponse {
	success: boolean
	transactionId: string
	character: {
		characterId: string
		characterName: string
		newBalance: number
	}
	corporation: {
		corporationId: string
		corporationName: string
		newBalance: number
	}
}

export interface BulkAwardDkpRequest {
	awards: Array<{
		characterName: string
		corporationId?: string
		amount: number
		reason?: string
	}>
	globalReason: string
	sourceType?: 'fleet' | 'manual'
	sourceId?: string
	earnedAt?: string
}

export interface BulkAwardDkpResponse {
	success: boolean
	totalAwarded: number
	transactions: Array<{
		characterName: string
		characterId: string
		transactionId: string
		amount: number
	}>
	errors: Array<{
		characterName: string
		error: string
	}>
}

export interface DkpFilters {
	userId?: string
	characterId?: string
	corporationId?: string
	sourceType?: DkpSourceType
	startDate?: string
	endDate?: string
	limit?: number
	offset?: number
}

export interface LeaderboardFilters {
	period?: DkpPeriod
	corporationId?: string
	limit?: number
	offset?: number
}
