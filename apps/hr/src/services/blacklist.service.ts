import { and, desc, eq, inArray, or } from '@repo/db-utils'

import { blacklistEntries } from '../db/schema'

import type { DbClient } from '@repo/db-utils'
import type * as schema from '../db/schema'

/**
 * Target type for blacklist entries
 */
export type BlacklistTargetType = 'user' | 'character'

/**
 * Blacklist entry data structure
 */
export interface BlacklistEntry {
	id: string
	targetType: BlacklistTargetType
	userId: string | null
	characterId: string | null
	reason: string
	blacklistedBy: string
	triggeredBy: string | null
	isAutoBlacklist: boolean
	metadata: Record<string, unknown> | null
	createdAt: Date
}

/**
 * Parameters for creating a user blacklist
 */
export interface CreateUserBlacklistParams {
	userId: string
	reason: string
	blacklistedBy: string
	triggeredBy?: string
	isAutoBlacklist?: boolean
	metadata?: Record<string, unknown>
}

/**
 * Parameters for creating a character blacklist
 */
export interface CreateCharacterBlacklistParams {
	characterId: string
	reason: string
	blacklistedBy: string
	metadata?: Record<string, unknown>
}

/**
 * Filters for listing blacklists
 */
export interface BlacklistFilters {
	targetType?: BlacklistTargetType
	isAutoBlacklist?: boolean
	userId?: string
	characterId?: string
	limit?: number
	offset?: number
}

/**
 * Paginated blacklist results
 */
export interface BlacklistResults {
	entries: BlacklistEntry[]
	total: number
	limit: number
	offset: number
}

/**
 * Blacklist Service
 *
 * Manages global blacklisting for users and characters.
 *
 * SECURITY CRITICAL: This service controls access to the entire platform.
 *
 * Two types of blacklists:
 * 1. User blacklist: User account is banned (cannot login)
 * 2. Character blacklist: EVE character is banned (anyone who uses it gets auto-blacklisted)
 *
 * Note: Auto-blacklist logic is coordinated with the Core worker since it has
 * access to the userCharacters table. This service manages the blacklist entries.
 */
export class BlacklistService {
	constructor(private db: DbClient<typeof schema>) {}

	/**
	 * Check if a user is blacklisted
	 * Fast lookup - used on every auth request
	 */
	async isUserBlacklisted(userId: string): Promise<boolean> {
		const entry = await this.db.query.blacklistEntries.findFirst({
			where: and(eq(blacklistEntries.targetType, 'user'), eq(blacklistEntries.userId, userId)),
			columns: { id: true },
		})

		return !!entry
	}

	/**
	 * Check if a character is blacklisted
	 * Fast lookup - used on login and character linking
	 */
	async isCharacterBlacklisted(characterId: string): Promise<boolean> {
		const entry = await this.db.query.blacklistEntries.findFirst({
			where: and(
				eq(blacklistEntries.targetType, 'character'),
				eq(blacklistEntries.characterId, characterId)
			),
			columns: { id: true },
		})

		return !!entry
	}

	/**
	 * Bulk check if multiple characters are blacklisted
	 * Optimized for checking many characters at once
	 * @param characterIds - Array of character IDs to check
	 * @returns Object mapping character ID to blacklist status
	 */
	async checkCharactersBlacklisted(characterIds: string[]): Promise<Record<string, boolean>> {
		// Return empty object if no character IDs provided
		if (characterIds.length === 0) {
			return {}
		}

		// Query for all blacklisted characters in the provided list
		const blacklistedEntries = await this.db
			.select({ characterId: blacklistEntries.characterId })
			.from(blacklistEntries)
			.where(
				and(
					eq(blacklistEntries.targetType, 'character'),
					inArray(blacklistEntries.characterId, characterIds)
				)
			)

		// Create a Set of blacklisted character IDs for fast lookup
		const blacklistedSet = new Set(
			blacklistedEntries.map((entry) => entry.characterId).filter((id): id is string => id !== null)
		)

		// Map each character ID to its blacklist status
		const result: Record<string, boolean> = {}
		for (const characterId of characterIds) {
			result[characterId] = blacklistedSet.has(characterId)
		}

		return result
	}

	/**
	 * Create a user blacklist entry
	 * Used for both manual blacklists and auto-blacklists triggered by characters
	 */
	async createUserBlacklist(params: CreateUserBlacklistParams): Promise<BlacklistEntry> {
		// Check if user is already blacklisted
		const existing = await this.db.query.blacklistEntries.findFirst({
			where: and(
				eq(blacklistEntries.targetType, 'user'),
				eq(blacklistEntries.userId, params.userId)
			),
		})

		if (existing) {
			// Already blacklisted - return existing entry
			return this.mapToBlacklistEntry(existing)
		}

		// Create new blacklist entry
		const [entry] = await this.db
			.insert(blacklistEntries)
			.values({
				targetType: 'user',
				userId: params.userId,
				characterId: null,
				reason: params.reason,
				blacklistedBy: params.blacklistedBy,
				triggeredBy: params.triggeredBy ?? null,
				isAutoBlacklist: params.isAutoBlacklist ?? false,
				metadata: params.metadata ?? null,
			})
			.returning()

		if (!entry) {
			throw new Error('Failed to create user blacklist entry')
		}

		return this.mapToBlacklistEntry(entry)
	}

	/**
	 * Create a character blacklist entry
	 * The Core worker will handle finding users with this character and auto-blacklisting them
	 */
	async createCharacterBlacklist(params: CreateCharacterBlacklistParams): Promise<BlacklistEntry> {
		// Check if character is already blacklisted
		const existing = await this.db.query.blacklistEntries.findFirst({
			where: and(
				eq(blacklistEntries.targetType, 'character'),
				eq(blacklistEntries.characterId, params.characterId)
			),
		})

		if (existing) {
			// Already blacklisted - return existing entry
			return this.mapToBlacklistEntry(existing)
		}

		// Create new blacklist entry
		const [entry] = await this.db
			.insert(blacklistEntries)
			.values({
				targetType: 'character',
				userId: null,
				characterId: params.characterId,
				reason: params.reason,
				blacklistedBy: params.blacklistedBy,
				triggeredBy: null,
				isAutoBlacklist: false,
				metadata: params.metadata ?? null,
			})
			.returning()

		if (!entry) {
			throw new Error('Failed to create character blacklist entry')
		}

		return this.mapToBlacklistEntry(entry)
	}

	/**
	 * Remove a blacklist entry
	 * IMPORTANT: Removing a character blacklist does NOT remove user blacklists it triggered
	 */
	async removeBlacklistEntry(id: string): Promise<void> {
		const result = await this.db.delete(blacklistEntries).where(eq(blacklistEntries.id, id))

		// Drizzle's delete doesn't return affected rows in a standard way, so we don't verify
		// If the entry didn't exist, the delete is a no-op (idempotent)
	}

	/**
	 * Get all blacklist entries for a user (including auto-blacklists)
	 */
	async getBlacklistsForUser(userId: string): Promise<BlacklistEntry[]> {
		const entries = await this.db.query.blacklistEntries.findMany({
			where: and(eq(blacklistEntries.targetType, 'user'), eq(blacklistEntries.userId, userId)),
			orderBy: [desc(blacklistEntries.createdAt)],
		})

		return entries.map((e) => this.mapToBlacklistEntry(e))
	}

	/**
	 * Get all blacklist entries for a character
	 */
	async getBlacklistsForCharacter(characterId: string): Promise<BlacklistEntry[]> {
		const entries = await this.db.query.blacklistEntries.findMany({
			where: and(
				eq(blacklistEntries.targetType, 'character'),
				eq(blacklistEntries.characterId, characterId)
			),
			orderBy: [desc(blacklistEntries.createdAt)],
		})

		return entries.map((e) => this.mapToBlacklistEntry(e))
	}

	/**
	 * Get a specific blacklist entry by ID
	 */
	async getBlacklistEntry(id: string): Promise<BlacklistEntry | null> {
		const entry = await this.db.query.blacklistEntries.findFirst({
			where: eq(blacklistEntries.id, id),
		})

		return entry ? this.mapToBlacklistEntry(entry) : null
	}

	/**
	 * Get user blacklists triggered by a character blacklist
	 * Used to show "N users auto-blacklisted from this character"
	 */
	async getTriggeredBlacklists(characterBlacklistId: string): Promise<BlacklistEntry[]> {
		const entries = await this.db.query.blacklistEntries.findMany({
			where: eq(blacklistEntries.triggeredBy, characterBlacklistId),
			orderBy: [desc(blacklistEntries.createdAt)],
		})

		return entries.map((e) => this.mapToBlacklistEntry(e))
	}

	/**
	 * Find ALL blacklist entries triggered by a specific entry (for cascading removal)
	 * Includes both:
	 * - User blacklists with triggeredBy pointing to this entry
	 * - Character blacklists with metadata.triggeredByUserBlacklist pointing to this entry
	 */
	async findTriggeredEntries(blacklistId: string): Promise<BlacklistEntry[]> {
		// Find user blacklists triggered by this entry (via triggeredBy)
		const triggeredUsers = await this.db.query.blacklistEntries.findMany({
			where: eq(blacklistEntries.triggeredBy, blacklistId),
		})

		// Find character blacklists triggered by this entry (via metadata)
		// Note: This requires checking JSON metadata, which is database-specific
		// For now, we'll fetch all character blacklists and filter in-memory
		const allCharBlacklists = await this.db.query.blacklistEntries.findMany({
			where: eq(blacklistEntries.targetType, 'character'),
		})

		const triggeredChars = allCharBlacklists.filter((entry) => {
			if (!entry.metadata) return false
			const metadata = entry.metadata as Record<string, unknown>
			return metadata.triggeredByUserBlacklist === blacklistId
		})

		const allTriggered = [...triggeredUsers, ...triggeredChars]
		return allTriggered.map((e) => this.mapToBlacklistEntry(e))
	}

	/**
	 * List all blacklist entries with filters and pagination
	 */
	async getAllBlacklists(filters: BlacklistFilters = {}): Promise<BlacklistResults> {
		const limit = filters.limit ?? 50
		const offset = filters.offset ?? 0

		// Build where clause
		const conditions = []

		if (filters.targetType) {
			conditions.push(eq(blacklistEntries.targetType, filters.targetType))
		}

		if (filters.isAutoBlacklist !== undefined) {
			conditions.push(eq(blacklistEntries.isAutoBlacklist, filters.isAutoBlacklist))
		}

		if (filters.userId) {
			conditions.push(eq(blacklistEntries.userId, filters.userId))
		}

		if (filters.characterId) {
			conditions.push(eq(blacklistEntries.characterId, filters.characterId))
		}

		const whereClause = conditions.length > 0 ? and(...conditions) : undefined

		// Get entries with pagination
		const entries = await this.db.query.blacklistEntries.findMany({
			where: whereClause,
			orderBy: [desc(blacklistEntries.createdAt)],
			limit,
			offset,
		})

		// Get total count
		const totalResult = await this.db
			.select({ count: blacklistEntries.id })
			.from(blacklistEntries)
			.where(whereClause ?? undefined)

		const total = totalResult.length

		return {
			entries: entries.map((e) => this.mapToBlacklistEntry(e)),
			total,
			limit,
			offset,
		}
	}

	/**
	 * Map database row to BlacklistEntry interface
	 */
	private mapToBlacklistEntry(row: typeof blacklistEntries.$inferSelect): BlacklistEntry {
		return {
			id: row.id,
			targetType: row.targetType as BlacklistTargetType,
			userId: row.userId,
			characterId: row.characterId,
			reason: row.reason,
			blacklistedBy: row.blacklistedBy,
			triggeredBy: row.triggeredBy,
			isAutoBlacklist: row.isAutoBlacklist,
			metadata: row.metadata,
			createdAt: row.createdAt,
		}
	}
}
