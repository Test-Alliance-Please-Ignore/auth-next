import { and, desc, eq, gte, inArray, lte, sql } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'

import { dkpDecayConfig, dkpTransactions, userCharacters, users } from '../db/schema'

import type { EveCharacterData } from '@repo/eve-character-data'
import type { EveCorporationData } from '@repo/eve-corporation-data'
import type { DbClient, schema } from '../db'

const MS_PER_DAY = 86_400_000

/**
 * DKP Service - Business logic for DKP tracking operations
 *
 * Handles DKP awards, balance queries, leaderboards, and administration.
 * Implements shared pool model: character DKP automatically contributes to corporation totals.
 */
export class DkpService {
	constructor(
		private db: DbClient<typeof schema>,
		private eveCorporationDataNamespace?: DurableObjectNamespace,
		private eveCharacterDataNamespace?: DurableObjectNamespace
	) {}

	/**
	 * Award DKP to a single character
	 */
	async awardDkp(params: {
		characterId: string
		corporationId?: string
		amount: number
		sourceType: 'fleet' | 'market' | 'mining' | 'manual' | 'adjustment'
		sourceId?: string
		sourceMetadata?: Record<string, unknown>
		awardedBy?: string
		awardReason?: string
		earnedAt?: Date
	}): Promise<{
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
	}> {
		// Validate inputs
		if (params.amount === 0) {
			throw new Error('Amount cannot be zero')
		}

		// Prevent negative amounts (only positive awards allowed)
		if (params.amount < 0) {
			throw new Error('Amount must be positive')
		}

		// Validate reasonable limits to prevent overflow
		if (Math.abs(params.amount) > 1000000) {
			throw new Error('Amount exceeds maximum allowed value (1,000,000)')
		}

		if (params.sourceType === 'manual' && !params.awardReason) {
			throw new Error('Reason is required for manual awards')
		}

		// Get character and corporation info
		let characterName = ''
		let corporationId = params.corporationId || ''
		let corporationName = ''

		// Strategy 1: Try eve-character-data Durable Object (most reliable, ESI-backed)
		if (this.eveCharacterDataNamespace) {
			try {
				const charStub = getStub<EveCharacterData>(
					this.eveCharacterDataNamespace,
					params.characterId
				)
				const characterInfo = await charStub.getCharacterInfo(params.characterId)

				if (characterInfo) {
					characterName = characterInfo.name
					if (!corporationId) {
						corporationId = characterInfo.corporationId.toString()
					}
					corporationName = characterInfo.corporationName || ''
				}
			} catch (error) {
				console.warn('Failed to get character info from eve-character-data:', error)
			}
		}

		// If we still don't have corporation ID, require it
		if (!corporationId) {
			throw new Error(
				'Corporation ID is required. Either provide it directly or ensure character data is available in eve-character-data.'
			)
		}

		// Strategy 2: Check existing transactions for cached names
		if (!characterName || !corporationName) {
			const existingTx = await this.db.query.dkpTransactions.findFirst({
				where: eq(dkpTransactions.characterId, params.characterId),
				orderBy: desc(dkpTransactions.createdAt),
			})

			if (existingTx) {
				characterName = characterName || existingTx.characterName
				corporationName = corporationName || existingTx.corporationName
			}
		}

		// Strategy 3: Try eve-corporation-data for corporation name if still missing
		if (!corporationName && this.eveCorporationDataNamespace) {
			try {
				const corpStub = getStub<EveCorporationData>(
					this.eveCorporationDataNamespace,
					corporationId
				)
				const corpInfo = await corpStub.getCorporationInfo(corporationId)
				if (corpInfo) {
					corporationName = corpInfo.name
				}
			} catch (error) {
				console.warn('Failed to get corporation info from eve-corporation-data:', error)
			}
		}

		// Final fallback - use IDs as names (should rarely happen now)
		if (!characterName) characterName = `Character ${params.characterId}`
		if (!corporationName) corporationName = `Corporation ${corporationId}`

		// Check for integer overflow when calculating new balance
		// For new characters with no transactions, assume 0 balance
		let currentBalanceAmount = 0
		try {
			const currentBalance = await this.getCharacterBalance(params.characterId)
			currentBalanceAmount = currentBalance.balance.current
		} catch (error) {
			// Character has no prior transactions, balance is 0
			currentBalanceAmount = 0
		}

		const newBalance = currentBalanceAmount + params.amount

		if (newBalance > Number.MAX_SAFE_INTEGER || newBalance < Number.MIN_SAFE_INTEGER) {
			throw new Error('Transaction would cause integer overflow')
		}

		if (!Number.isSafeInteger(newBalance)) {
			throw new Error('New balance exceeds safe integer range')
		}

		// Lookup userId from characterId
		let userId: string | null = null
		try {
			const userChar = await this.db.query.userCharacters.findFirst({
				where: eq(userCharacters.characterId, params.characterId),
			})
			userId = userChar?.userId || null
		} catch (error) {
			console.warn('Failed to lookup userId from characterId:', error)
		}

		// Create transaction
		const [transaction] = await this.db
			.insert(dkpTransactions)
			.values({
				userId,
				characterId: params.characterId,
				characterName,
				corporationId,
				corporationName,
				amount: params.amount,
				sourceType: params.sourceType,
				sourceId: params.sourceId,
				sourceMetadata: params.sourceMetadata,
				awardedBy: params.awardedBy,
				awardReason: params.awardReason,
				earnedAt: params.earnedAt || new Date(),
			})
			.returning()

		// Calculate new balances
		const charBalance = await this.getCharacterBalance(params.characterId)
		const corpBalance = await this.getCorporationBalance(corporationId)

		return {
			success: true,
			transactionId: transaction.id,
			character: {
				characterId: params.characterId,
				characterName,
				newBalance: charBalance.balance.current,
			},
			corporation: {
				corporationId,
				corporationName,
				newBalance: corpBalance.balance.current,
			},
		}
	}

	/**
	 * Resolve character names to character IDs
	 */
	private async resolveCharacterNames(
		names: string[]
	): Promise<Map<string, { characterId: string; error?: string }>> {
		const results = new Map<string, { characterId: string; error?: string }>()

		if (!this.eveCharacterDataNamespace) {
			// If character data namespace not available, mark all as errors
			for (const name of names) {
				results.set(name, {
					characterId: '',
					error: 'Character data service not available',
				})
			}
			return results
		}

		// Get unique names
		const uniqueNames = [...new Set(names)]

		// Get eve-character-data stub (use any character ID as the DO is stateless for search)
		const charDataStub = getStub<EveCharacterData>(this.eveCharacterDataNamespace, '0')

		// Resolve each name
		for (const name of uniqueNames) {
			try {
				const characterId = await charDataStub.searchCharacterByName(name, true)

				if (characterId) {
					results.set(name, { characterId })
				} else {
					results.set(name, {
						characterId: '',
						error: `Character '${name}' not found`,
					})
				}
			} catch (error) {
				results.set(name, {
					characterId: '',
					error: error instanceof Error ? error.message : 'Failed to resolve character name',
				})
			}
		}

		return results
	}

	/**
	 * Award DKP to multiple characters at once
	 */
	async awardDkpBulk(params: {
		awards: Array<{
			characterName: string
			corporationId?: string
			amount: number
			reason?: string
		}>
		globalReason: string
		sourceType?: 'fleet' | 'manual'
		sourceId?: string
		awardedBy?: string
		earnedAt?: Date
	}): Promise<{
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
	}> {
		const transactions: Array<{
			characterName: string
			characterId: string
			transactionId: string
			amount: number
		}> = []
		const errors: Array<{
			characterName: string
			error: string
		}> = []

		// Resolve all character names to IDs
		const characterNames = params.awards.map((a) => a.characterName)
		const nameToIdMap = await this.resolveCharacterNames(characterNames)

		for (const award of params.awards) {
			const resolution = nameToIdMap.get(award.characterName)

			if (!resolution || resolution.error) {
				errors.push({
					characterName: award.characterName,
					error: resolution?.error || 'Character not found',
				})
				continue
			}

			try {
				const result = await this.awardDkp({
					characterId: resolution.characterId,
					corporationId: award.corporationId,
					amount: award.amount,
					sourceType: params.sourceType || 'manual',
					sourceId: params.sourceId,
					awardedBy: params.awardedBy,
					awardReason: award.reason || params.globalReason,
					earnedAt: params.earnedAt,
				})

				transactions.push({
					characterName: award.characterName,
					characterId: resolution.characterId,
					transactionId: result.transactionId,
					amount: award.amount,
				})
			} catch (error) {
				errors.push({
					characterName: award.characterName,
					error: error instanceof Error ? error.message : 'Unknown error',
				})
			}
		}

		return {
			success: errors.length === 0,
			totalAwarded: transactions.length,
			transactions,
			errors,
		}
	}

	/**
	 * Get character DKP balance with time windows
	 */
	async getCharacterBalance(
		characterId: string,
		period?: '7d' | '30d' | '90d' | 'all'
	): Promise<{
		characterId: string
		characterName: string
		corporationId: string
		corporationName: string
		balance: {
			current: number
			allTime: number
			last7days: number
			last30days: number
			last90days: number
		}
		lastEarned?: {
			amount: number
			sourceType: string
			earnedAt: Date
		}
	}> {
		// Get all transactions for character
		const transactions = await this.db.query.dkpTransactions.findMany({
			where: eq(dkpTransactions.characterId, characterId),
			orderBy: desc(dkpTransactions.earnedAt),
		})

		if (transactions.length === 0) {
			throw new Error('Character not found or has no DKP transactions')
		}

		const now = new Date()
		const last7days = new Date(now.getTime() - 7 * MS_PER_DAY)
		const last30days = new Date(now.getTime() - 30 * MS_PER_DAY)
		const last90days = new Date(now.getTime() - 90 * MS_PER_DAY)

		let totalAll = 0
		let total7d = 0
		let total30d = 0
		let total90d = 0

		for (const tx of transactions) {
			totalAll += tx.amount
			if (tx.earnedAt >= last7days) total7d += tx.amount
			if (tx.earnedAt >= last30days) total30d += tx.amount
			if (tx.earnedAt >= last90days) total90d += tx.amount
		}

		const latestTx = transactions[0]

		return {
			characterId,
			characterName: latestTx.characterName,
			corporationId: latestTx.corporationId,
			corporationName: latestTx.corporationName,
			balance: {
				current: totalAll,
				allTime: totalAll,
				last7days: total7d,
				last30days: total30d,
				last90days: total90d,
			},
			lastEarned: {
				amount: latestTx.amount,
				sourceType: latestTx.sourceType,
				earnedAt: latestTx.earnedAt,
			},
		}
	}

	/**
	 * Get user DKP balance (sum across all characters)
	 */
	async getUserBalance(
		userId: string,
		period?: '7d' | '30d' | '90d' | 'all'
	): Promise<{
		userId: string
		balance: {
			current: number
			allTime: number
			last7days: number
			last30days: number
			last90days: number
		}
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
			sourceType: string
			earnedAt: Date
		}
	}> {
		// Get all transactions for user
		const transactions = await this.db.query.dkpTransactions.findMany({
			where: eq(dkpTransactions.userId, userId),
			orderBy: desc(dkpTransactions.earnedAt),
		})

		if (transactions.length === 0) {
			throw new Error('User not found or has no DKP transactions')
		}

		const now = new Date()
		const last7days = new Date(now.getTime() - 7 * MS_PER_DAY)
		const last30days = new Date(now.getTime() - 30 * MS_PER_DAY)
		const last90days = new Date(now.getTime() - 90 * MS_PER_DAY)

		let totalAll = 0
		let total7d = 0
		let total30d = 0
		let total90d = 0

		// Calculate totals
		for (const tx of transactions) {
			totalAll += tx.amount
			if (tx.earnedAt >= last7days) total7d += tx.amount
			if (tx.earnedAt >= last30days) total30d += tx.amount
			if (tx.earnedAt >= last90days) total90d += tx.amount
		}

		// Calculate per-character breakdown
		const characterTotals = new Map<
			string,
			{
				name: string
				corporationId: string
				corporationName: string
				amount: number
			}
		>()

		for (const tx of transactions) {
			const existing = characterTotals.get(tx.characterId)
			if (existing) {
				existing.amount += tx.amount
			} else {
				characterTotals.set(tx.characterId, {
					name: tx.characterName,
					corporationId: tx.corporationId,
					corporationName: tx.corporationName,
					amount: tx.amount,
				})
			}
		}

		const characterBreakdown = Array.from(characterTotals.entries())
			.map(([characterId, data]) => ({
				characterId,
				characterName: data.name,
				corporationId: data.corporationId,
				corporationName: data.corporationName,
				balance: data.amount,
			}))
			.sort((a, b) => b.balance - a.balance)

		const latestTx = transactions[0]

		return {
			userId,
			balance: {
				current: totalAll,
				allTime: totalAll,
				last7days: total7d,
				last30days: total30d,
				last90days: total90d,
			},
			characterBreakdown,
			lastEarned: {
				characterId: latestTx.characterId,
				characterName: latestTx.characterName,
				amount: latestTx.amount,
				sourceType: latestTx.sourceType,
				earnedAt: latestTx.earnedAt,
			},
		}
	}

	/**
	 * Get corporation DKP balance (sum of all members)
	 */
	async getCorporationBalance(
		corporationId: string,
		period?: '7d' | '30d' | '90d' | 'all'
	): Promise<{
		corporationId: string
		corporationName: string
		balance: {
			current: number
			allTime: number
			last7days: number
			last30days: number
			last90days: number
		}
		memberCount: number
		topEarners: Array<{
			characterId: string
			characterName: string
			amount: number
		}>
	}> {
		const now = new Date()
		const last7days = new Date(now.getTime() - 7 * MS_PER_DAY)
		const last30days = new Date(now.getTime() - 30 * MS_PER_DAY)
		const last90days = new Date(now.getTime() - 90 * MS_PER_DAY)

		// Get all transactions for corporation
		const transactions = await this.db.query.dkpTransactions.findMany({
			where: eq(dkpTransactions.corporationId, corporationId),
		})

		if (transactions.length === 0) {
			throw new Error('Corporation not found or has no DKP transactions')
		}

		let totalAll = 0
		let total7d = 0
		let total30d = 0
		let total90d = 0

		for (const tx of transactions) {
			totalAll += tx.amount
			if (tx.earnedAt >= last7days) total7d += tx.amount
			if (tx.earnedAt >= last30days) total30d += tx.amount
			if (tx.earnedAt >= last90days) total90d += tx.amount
		}

		// Get unique members and their totals for top earners
		const memberTotals = new Map<string, { name: string; amount: number }>()

		for (const tx of transactions) {
			const existing = memberTotals.get(tx.characterId)
			if (existing) {
				existing.amount += tx.amount
			} else {
				memberTotals.set(tx.characterId, {
					name: tx.characterName,
					amount: tx.amount,
				})
			}
		}

		const topEarners = Array.from(memberTotals.entries())
			.map(([characterId, data]) => ({
				characterId,
				characterName: data.name,
				amount: data.amount,
			}))
			.sort((a, b) => b.amount - a.amount)
			.slice(0, 5)

		return {
			corporationId,
			corporationName: transactions[0].corporationName,
			balance: {
				current: totalAll,
				allTime: totalAll,
				last7days: total7d,
				last30days: total30d,
				last90days: total90d,
			},
			memberCount: memberTotals.size,
			topEarners,
		}
	}

	/**
	 * Get character leaderboard
	 */
	async getCharacterLeaderboard(params: {
		period?: '7d' | '30d' | '90d' | 'all'
		corporationId?: string
		limit?: number
		offset?: number
	}): Promise<{
		period: string
		leaderboard: Array<{
			rank: number
			characterId: string
			characterName: string
			corporationId: string
			corporationName: string
			balance: number
			transactionCount: number
		}>
		pagination: {
			limit: number
			offset: number
			total: number
		}
	}> {
		const limit = params.limit || 50
		const offset = params.offset || 0
		const period = params.period || 'all'

		// Calculate time filter
		let timeFilter: Date | null = null
		if (period !== 'all') {
			const now = new Date()
			const days = period === '7d' ? 7 : period === '30d' ? 30 : period === '90d' ? 90 : 0
			timeFilter = new Date(now.getTime() - days * MS_PER_DAY)
		}

		// Build where conditions
		const whereConditions = []
		if (timeFilter) {
			whereConditions.push(gte(dkpTransactions.earnedAt, timeFilter))
		}
		if (params.corporationId) {
			whereConditions.push(eq(dkpTransactions.corporationId, params.corporationId))
		}

		// Query with aggregation
		const results = await this.db
			.select({
				characterId: dkpTransactions.characterId,
				characterName: dkpTransactions.characterName,
				corporationId: dkpTransactions.corporationId,
				corporationName: dkpTransactions.corporationName,
				balance: sql<number>`SUM(${dkpTransactions.amount})`,
				transactionCount: sql<number>`COUNT(*)`,
			})
			.from(dkpTransactions)
			.where(whereConditions.length > 0 ? and(...whereConditions) : undefined)
			.groupBy(
				dkpTransactions.characterId,
				dkpTransactions.characterName,
				dkpTransactions.corporationId,
				dkpTransactions.corporationName
			)
			.orderBy(desc(sql`SUM(${dkpTransactions.amount})`))
			.limit(limit)
			.offset(offset)

		// Add ranking
		const leaderboard = results.map((row, index) => ({
			rank: offset + index + 1,
			characterId: row.characterId,
			characterName: row.characterName,
			corporationId: row.corporationId,
			corporationName: row.corporationName,
			balance: Number(row.balance),
			transactionCount: Number(row.transactionCount),
		}))

		// Get total count for pagination
		const totalResults = await this.db
			.select({
				count: sql<number>`COUNT(DISTINCT ${dkpTransactions.characterId})`,
			})
			.from(dkpTransactions)
			.where(whereConditions.length > 0 ? and(...whereConditions) : undefined)

		return {
			period,
			leaderboard,
			pagination: {
				limit,
				offset,
				total: Number(totalResults[0]?.count ?? 0),
			},
		}
	}

	/**
	 * Get user leaderboard
	 */
	async getUserLeaderboard(params: {
		period?: '7d' | '30d' | '90d' | 'all'
		limit?: number
		offset?: number
	}): Promise<{
		period: string
		leaderboard: Array<{
			rank: number
			userId: string
			mainCharacterName: string
			balance: number
			characterCount: number
			transactionCount: number
		}>
		pagination: {
			limit: number
			offset: number
			total: number
		}
	}> {
		const limit = params.limit || 50
		const offset = params.offset || 0
		const period = params.period || 'all'

		// Calculate time filter
		let timeFilter: Date | null = null
		if (period !== 'all') {
			const now = new Date()
			const days = period === '7d' ? 7 : period === '30d' ? 30 : period === '90d' ? 90 : 0
			timeFilter = new Date(now.getTime() - days * MS_PER_DAY)
		}

		// Query with aggregation by userId
		const results = await this.db
			.select({
				userId: dkpTransactions.userId,
				balance: sql<number>`SUM(${dkpTransactions.amount})`,
				characterCount: sql<number>`COUNT(DISTINCT ${dkpTransactions.characterId})`,
				transactionCount: sql<number>`COUNT(*)`,
			})
			.from(dkpTransactions)
			.where(
				and(
					sql`${dkpTransactions.userId} IS NOT NULL`,
					timeFilter ? gte(dkpTransactions.earnedAt, timeFilter) : undefined
				)
			)
			.groupBy(dkpTransactions.userId)
			.orderBy(desc(sql`SUM(${dkpTransactions.amount})`))
			.limit(limit)
			.offset(offset)

		// Look up main character names for each user
		const userIds = results.map((r) => r.userId!).filter(Boolean)
		const userMainCharacters = await this.db.query.users.findMany({
			where: inArray(users.id, userIds),
			columns: {
				id: true,
				mainCharacterId: true,
			},
		})

		// Create a map of userId -> mainCharacterId
		const mainCharIdMap = new Map(userMainCharacters.map((u) => [u.id, u.mainCharacterId]))

		// Look up character names from dkpTransactions (cached names)
		const mainCharIds = Array.from(new Set(userMainCharacters.map((u) => u.mainCharacterId)))
		const charNames = await this.db.query.dkpTransactions.findMany({
			where: inArray(dkpTransactions.characterId, mainCharIds),
			columns: {
				characterId: true,
				characterName: true,
			},
		})

		// Create map of characterId -> name
		const charNameMap = new Map(charNames.map((c) => [c.characterId, c.characterName]))

		// Add ranking and main character names
		const leaderboard = results.map((row, index) => {
			const userId = row.userId!
			const mainCharId = mainCharIdMap.get(userId)
			const mainCharacterName = mainCharId
				? charNameMap.get(mainCharId) || `Character ${mainCharId}`
				: 'Unknown'

			return {
				rank: offset + index + 1,
				userId,
				mainCharacterName,
				balance: Number(row.balance),
				characterCount: Number(row.characterCount),
				transactionCount: Number(row.transactionCount),
			}
		})

		// Get total count for pagination
		const totalResults = await this.db
			.select({
				count: sql<number>`COUNT(DISTINCT ${dkpTransactions.userId})`,
			})
			.from(dkpTransactions)
			.where(
				and(
					sql`${dkpTransactions.userId} IS NOT NULL`,
					timeFilter ? gte(dkpTransactions.earnedAt, timeFilter) : undefined
				)
			)

		return {
			period,
			leaderboard,
			pagination: {
				limit,
				offset,
				total: Number(totalResults[0]?.count ?? 0),
			},
		}
	}

	/**
	 * Get corporation leaderboard
	 */
	async getCorporationLeaderboard(params: {
		period?: '7d' | '30d' | '90d' | 'all'
		limit?: number
		offset?: number
	}): Promise<{
		period: string
		leaderboard: Array<{
			rank: number
			corporationId: string
			corporationName: string
			balance: number
			memberCount: number
			transactionCount: number
			averagePerMember: number
		}>
		pagination: {
			limit: number
			offset: number
			total: number
		}
	}> {
		const limit = params.limit || 50
		const offset = params.offset || 0
		const period = params.period || 'all'

		// Calculate time filter
		let timeFilter: Date | null = null
		if (period !== 'all') {
			const now = new Date()
			const days = period === '7d' ? 7 : period === '30d' ? 30 : period === '90d' ? 90 : 0
			timeFilter = new Date(now.getTime() - days * MS_PER_DAY)
		}

		// Query with aggregation
		const results = await this.db
			.select({
				corporationId: dkpTransactions.corporationId,
				corporationName: dkpTransactions.corporationName,
				balance: sql<number>`SUM(${dkpTransactions.amount})`,
				memberCount: sql<number>`COUNT(DISTINCT ${dkpTransactions.characterId})`,
				transactionCount: sql<number>`COUNT(*)`,
			})
			.from(dkpTransactions)
			.where(timeFilter ? gte(dkpTransactions.earnedAt, timeFilter) : undefined)
			.groupBy(dkpTransactions.corporationId, dkpTransactions.corporationName)
			.orderBy(desc(sql`SUM(${dkpTransactions.amount})`))
			.limit(limit)
			.offset(offset)

		// Add ranking and averages
		const leaderboard = results.map((row, index) => ({
			rank: offset + index + 1,
			corporationId: row.corporationId,
			corporationName: row.corporationName,
			balance: Number(row.balance),
			memberCount: Number(row.memberCount),
			transactionCount: Number(row.transactionCount),
			averagePerMember: Math.round(Number(row.balance) / Number(row.memberCount)),
		}))

		// Get total count for pagination
		const totalResults = await this.db
			.select({
				count: sql<number>`COUNT(DISTINCT ${dkpTransactions.corporationId})`,
			})
			.from(dkpTransactions)
			.where(timeFilter ? gte(dkpTransactions.earnedAt, timeFilter) : undefined)

		return {
			period,
			leaderboard,
			pagination: {
				limit,
				offset,
				total: Number(totalResults[0]?.count ?? 0),
			},
		}
	}

	/**
	 * Get transaction history
	 */
	async getTransactionHistory(params: {
		userId?: string
		characterId?: string
		characterIds?: string[]
		corporationId?: string
		sourceType?: string
		limit?: number
		offset?: number
		startDate?: Date
		endDate?: Date
	}): Promise<{
		transactions: Array<{
			id: string
			characterId: string
			characterName: string
			corporationId: string
			corporationName: string
			amount: number
			sourceType: string
			sourceId?: string
			sourceMetadata?: Record<string, unknown>
			awardedBy?: string
			awardReason?: string
			earnedAt: Date
			createdAt: Date
		}>
		pagination: {
			limit: number
			offset: number
			total: number
		}
	}> {
		const limit = params.limit || 50
		const offset = params.offset || 0

		// Build where conditions
		const whereConditions = []
		if (params.userId) {
			whereConditions.push(eq(dkpTransactions.userId, params.userId))
		}
		if (params.characterId) {
			whereConditions.push(eq(dkpTransactions.characterId, params.characterId))
		}
		if (params.characterIds && params.characterIds.length > 0) {
			whereConditions.push(inArray(dkpTransactions.characterId, params.characterIds))
		}
		if (params.corporationId) {
			whereConditions.push(eq(dkpTransactions.corporationId, params.corporationId))
		}
		if (params.sourceType) {
			whereConditions.push(
				eq(
					dkpTransactions.sourceType,
					params.sourceType as 'fleet' | 'market' | 'mining' | 'manual' | 'adjustment'
				)
			)
		}
		if (params.startDate) {
			whereConditions.push(gte(dkpTransactions.earnedAt, params.startDate))
		}
		if (params.endDate) {
			whereConditions.push(lte(dkpTransactions.earnedAt, params.endDate))
		}

		// Query transactions
		const results = await this.db.query.dkpTransactions.findMany({
			where: whereConditions.length > 0 ? and(...whereConditions) : undefined,
			orderBy: desc(dkpTransactions.earnedAt),
			limit,
			offset,
		})

		// Get total count
		const totalResults = await this.db
			.select({
				count: sql<number>`COUNT(*)`,
			})
			.from(dkpTransactions)
			.where(whereConditions.length > 0 ? and(...whereConditions) : undefined)

		return {
			transactions: results.map((tx) => ({
				id: tx.id,
				characterId: tx.characterId,
				characterName: tx.characterName,
				corporationId: tx.corporationId,
				corporationName: tx.corporationName,
				amount: tx.amount,
				sourceType: tx.sourceType,
				sourceId: tx.sourceId || undefined,
				sourceMetadata: (tx.sourceMetadata as Record<string, unknown>) || undefined,
				awardedBy: tx.awardedBy || undefined,
				awardReason: tx.awardReason || undefined,
				earnedAt: tx.earnedAt,
				createdAt: tx.createdAt,
			})),
			pagination: {
				limit,
				offset,
				total: Number(totalResults[0]?.count ?? 0),
			},
		}
	}

	/**
	 * Get admin statistics
	 */
	async getStatistics(): Promise<{
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
	}> {
		const now = new Date()
		const last7days = new Date(now.getTime() - 7 * MS_PER_DAY)
		const last30days = new Date(now.getTime() - 30 * MS_PER_DAY)
		const last90days = new Date(now.getTime() - 90 * MS_PER_DAY)

		// Get all transactions
		const allTransactions = await this.db.query.dkpTransactions.findMany()

		let totalAll = 0
		let total7d = 0
		let total30d = 0
		let total90d = 0

		const breakdown = {
			fleet: 0,
			market: 0,
			mining: 0,
			manual: 0,
			adjustment: 0,
		}

		for (const tx of allTransactions) {
			totalAll += tx.amount
			if (tx.earnedAt >= last7days) total7d += tx.amount
			if (tx.earnedAt >= last30days) total30d += tx.amount
			if (tx.earnedAt >= last90days) total90d += tx.amount

			if (tx.sourceType in breakdown) {
				breakdown[tx.sourceType as keyof typeof breakdown] += tx.amount
			}
		}

		// Get top characters
		const topChars = await this.db
			.select({
				characterId: dkpTransactions.characterId,
				characterName: dkpTransactions.characterName,
				amount: sql<number>`SUM(${dkpTransactions.amount})`,
			})
			.from(dkpTransactions)
			.groupBy(dkpTransactions.characterId, dkpTransactions.characterName)
			.orderBy(desc(sql`SUM(${dkpTransactions.amount})`))
			.limit(10)

		// Get top corporations
		const topCorps = await this.db
			.select({
				corporationId: dkpTransactions.corporationId,
				corporationName: dkpTransactions.corporationName,
				amount: sql<number>`SUM(${dkpTransactions.amount})`,
			})
			.from(dkpTransactions)
			.groupBy(dkpTransactions.corporationId, dkpTransactions.corporationName)
			.orderBy(desc(sql`SUM(${dkpTransactions.amount})`))
			.limit(10)

		return {
			totals: {
				allTime: totalAll,
				last7days: total7d,
				last30days: total30d,
				last90days: total90d,
			},
			breakdown,
			topCharacters: topChars.map((row) => ({
				characterId: row.characterId,
				characterName: row.characterName,
				amount: Number(row.amount),
			})),
			topCorporations: topCorps.map((row) => ({
				corporationId: row.corporationId,
				corporationName: row.corporationName,
				amount: Number(row.amount),
			})),
		}
	}
}
