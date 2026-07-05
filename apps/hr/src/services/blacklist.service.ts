import { and, desc, eq, ilike, inArray, or, sql } from '@repo/db-utils'

import { blacklistEntries } from '../db/schema'

import type {
	BlacklistEntry,
	BlacklistFilters,
	BlacklistResults,
	BlacklistTargetCheckItem,
	BlacklistTargetCheckResult,
	BlacklistTargetType,
	CharacterIdNameBlacklistResult,
	CharacterIdNamePair,
	CreateCharacterBlacklistParams,
	CreateDiscordBlacklistParams,
	CreateUserBlacklistParams,
} from '@repo/hr'
import type { ServiceContext } from './context'

/**
 * Blacklist Service
 *
 * Manages global blacklisting for users and characters.
 *
 * SECURITY CRITICAL: This service controls access to the entire platform.
 */
export class BlacklistService {
	constructor(private ctx: ServiceContext) {}

	private normalizeCharacterName(characterName: string): string {
		return characterName.trim().toLowerCase()
	}

	/**
	 * Check if a user is blacklisted
	 * Fast lookup - used on every auth request
	 */
	async isUserBlacklisted(userId: string): Promise<boolean> {
		const entry = await this.ctx.db.query.blacklistEntries.findFirst({
			where: and(eq(blacklistEntries.targetType, 'user'), eq(blacklistEntries.targetValue, userId)),
			columns: { id: true },
		})

		return !!entry
	}

	/**
	 * Check if a Discord user is blacklisted
	 * Fast lookup - used during Discord linking
	 */
	async isDiscordUserBlacklisted(discordUserId: string): Promise<boolean> {
		const entry = await this.ctx.db.query.blacklistEntries.findFirst({
			where: and(
				eq(blacklistEntries.targetType, 'discord_id'),
				eq(blacklistEntries.targetValue, discordUserId)
			),
			columns: { id: true },
		})

		return !!entry
	}

	/**
	 * Check if a character is blacklisted
	 * Fast lookup - used on login and character linking
	 */
	async isCharacterBlacklisted(characterId: string): Promise<boolean> {
		const entry = await this.ctx.db.query.blacklistEntries.findFirst({
			where: and(
				eq(blacklistEntries.targetType, 'character_id'),
				eq(blacklistEntries.targetValue, characterId)
			),
			columns: { id: true },
		})

		return !!entry
	}

	/**
	 * Check if a character name is blacklisted
	 * Fast lookup - used on login and character linking
	 */
	async isCharacterNameBlacklisted(characterName: string): Promise<boolean> {
		const normalizedName = this.normalizeCharacterName(characterName)
		const entry = await this.ctx.db.query.blacklistEntries.findFirst({
			where: and(
				eq(blacklistEntries.targetType, 'character_name'),
				eq(blacklistEntries.targetValue, normalizedName)
			),
			columns: { id: true },
		})

		return !!entry
	}

	/**
	 * Check if either character ID or character name is blacklisted.
	 */
	async isCharacterIdOrNameBlacklisted(characterId: string, characterName?: string): Promise<boolean> {
		const [idMatch, nameMatch] = await Promise.all([
			this.isCharacterBlacklisted(characterId),
			characterName?.trim() ? this.isCharacterNameBlacklisted(characterName) : Promise.resolve(false),
		])

		return idMatch || nameMatch
	}

	/**
	 * Bulk check if multiple characters are blacklisted
	 * Optimized for checking many characters at once
	 */
	async checkCharactersBlacklisted(characterIds: string[]): Promise<Record<string, boolean>> {
		if (characterIds.length === 0) {
			return {}
		}

		const blacklistedRows = await this.ctx.db
			.select({ targetValue: blacklistEntries.targetValue })
			.from(blacklistEntries)
			.where(
				and(
					eq(blacklistEntries.targetType, 'character_id'),
					inArray(blacklistEntries.targetValue, characterIds)
				)
			)

		const blacklistedSet = new Set(
			blacklistedRows
				.map((row) => row.targetValue)
				.filter((id): id is string => typeof id === 'string' && id.length > 0)
		)

		const result: Record<string, boolean> = {}
		for (const characterId of characterIds) {
			result[characterId] = blacklistedSet.has(characterId)
		}

		return result
	}

	/**
	 * Bulk check if multiple character names are blacklisted
	 * Optimized for checking many names at once
	 */
	async checkCharacterNamesBlacklisted(characterNames: string[]): Promise<Record<string, boolean>> {
		if (characterNames.length === 0) return {}

		const normalizedNames = Array.from(
			new Set(
				characterNames
					.map((name) => this.normalizeCharacterName(name))
					.filter((name) => name.length > 0)
			)
		)

		if (normalizedNames.length === 0) {
			const emptyResult: Record<string, boolean> = {}
			for (const name of characterNames) emptyResult[name] = false
			return emptyResult
		}

		const blacklistedRows = await this.ctx.db
			.select({ targetValue: blacklistEntries.targetValue })
			.from(blacklistEntries)
			.where(
				and(
					eq(blacklistEntries.targetType, 'character_name'),
					inArray(blacklistEntries.targetValue, normalizedNames)
				)
			)

		const blacklistedSet = new Set(
			blacklistedRows
				.map((row) => row.targetValue)
				.filter((name): name is string => typeof name === 'string' && name.length > 0)
		)

		const result: Record<string, boolean> = {}
		for (const originalName of characterNames) {
			const normalized = this.normalizeCharacterName(originalName)
			result[originalName] = normalized.length > 0 && blacklistedSet.has(normalized)
		}

		return result
	}

	/**
	 * Bulk check character ID/name pairs using OR semantics per pair.
	 */
	async checkCharacterIdOrNamePairsBlacklisted(
		pairs: CharacterIdNamePair[]
	): Promise<CharacterIdNameBlacklistResult[]> {
		if (pairs.length === 0) return []

		const uniqueIds = Array.from(
			new Set(
				pairs.map((pair) => pair.characterId?.trim()).filter((id): id is string => Boolean(id))
			)
		)
		const uniqueNames = Array.from(
			new Set(
				pairs
					.map((pair) =>
						pair.characterName ? this.normalizeCharacterName(pair.characterName) : ''
					)
					.filter((name): name is string => name.length > 0)
			)
		)

		const [idMatches, nameMatches] = await Promise.all([
			uniqueIds.length > 0
				? this.ctx.db
						.select({ targetValue: blacklistEntries.targetValue })
						.from(blacklistEntries)
						.where(
							and(
								eq(blacklistEntries.targetType, 'character_id'),
								inArray(blacklistEntries.targetValue, uniqueIds)
							)
						)
				: Promise.resolve([]),
			uniqueNames.length > 0
				? this.ctx.db
						.select({ targetValue: blacklistEntries.targetValue })
						.from(blacklistEntries)
						.where(
							and(
								eq(blacklistEntries.targetType, 'character_name'),
								inArray(blacklistEntries.targetValue, uniqueNames)
							)
						)
				: Promise.resolve([]),
		])

		const idSet = new Set(
			idMatches
				.map((entry) => entry.targetValue)
				.filter((id): id is string => typeof id === 'string' && id.length > 0)
		)
		const nameSet = new Set(
			nameMatches
				.map((entry) => entry.targetValue)
				.filter((name): name is string => typeof name === 'string' && name.length > 0)
		)

		return pairs.map((pair) => {
			const idMatched = pair.characterId ? idSet.has(pair.characterId) : false
			const normalizedName = pair.characterName
				? this.normalizeCharacterName(pair.characterName)
				: ''
			const nameMatched = normalizedName.length > 0 ? nameSet.has(normalizedName) : false

			return {
				characterId: pair.characterId,
				characterName: pair.characterName,
				isBlacklisted: idMatched || nameMatched,
				matchedBy: idMatched && nameMatched ? 'both' : idMatched ? 'id' : nameMatched ? 'name' : 'none',
			}
		})
	}

	async checkBlacklistTargets(targets: BlacklistTargetCheckItem[]): Promise<BlacklistTargetCheckResult[]> {
		if (targets.length === 0) return []
		const normalizedTargets = targets
			.map((target) => {
				const rawValue = target.targetValue?.trim() ?? ''
				if (!rawValue) return null
				return {
					targetType: target.targetType,
					targetValue:
						target.targetType === 'character_name'
							? this.normalizeCharacterName(rawValue)
							: rawValue,
				} satisfies BlacklistTargetCheckItem
			})
			.filter((target): target is BlacklistTargetCheckItem => target !== null)

		if (normalizedTargets.length === 0) return []

		const grouped = new Map<BlacklistTargetType, string[]>()
		for (const target of normalizedTargets) {
			const bucket = grouped.get(target.targetType) ?? []
			bucket.push(target.targetValue)
			grouped.set(target.targetType, bucket)
		}

		const existing = new Map<
			string,
			{
				reason: string | null
				createdAt: Date | null
				blacklistedBy: string | null
				entryMode: 'manual' | 'automatic'
			}
		>()
		const chunkSize = 250
		for (const [targetType, values] of grouped.entries()) {
			const uniqueValues = [...new Set(values)]
			if (uniqueValues.length === 0) continue
			for (let index = 0; index < uniqueValues.length; index += chunkSize) {
				const valuesChunk = uniqueValues.slice(index, index + chunkSize)
				const rows = await this.ctx.db
					.select({
						targetType: blacklistEntries.targetType,
						targetValue: blacklistEntries.targetValue,
						reason: blacklistEntries.reason,
						createdAt: blacklistEntries.createdAt,
						blacklistedBy: blacklistEntries.blacklistedBy,
						isAutoBlacklist: blacklistEntries.isAutoBlacklist,
					})
					.from(blacklistEntries)
					.where(
						and(
							eq(blacklistEntries.targetType, targetType),
							inArray(blacklistEntries.targetValue, valuesChunk)
						)
					)
				for (const row of rows) {
					if (!row.targetType || !row.targetValue) continue
					existing.set(`${row.targetType}:${row.targetValue}`, {
						reason: row.reason ?? null,
						createdAt: row.createdAt ?? null,
						blacklistedBy: row.blacklistedBy ?? null,
						entryMode: row.isAutoBlacklist ? 'automatic' : 'manual',
					})
				}
			}
		}

		return normalizedTargets.map((target) => ({
			...(existing.get(`${target.targetType}:${target.targetValue}`) ?? {
				reason: null,
				createdAt: null,
				blacklistedBy: null,
				entryMode: null,
			}),
			targetType: target.targetType,
			targetValue: target.targetValue,
			isBlacklisted: existing.has(`${target.targetType}:${target.targetValue}`),
		}))
	}

	/**
	 * Get all blacklisted character IDs.
	 */
	async getAllBlacklistedCharacterIds(): Promise<string[]> {
		const rows = await this.ctx.db
			.select({ targetValue: blacklistEntries.targetValue })
			.from(blacklistEntries)
			.where(eq(blacklistEntries.targetType, 'character_id'))

		return rows
			.map((row) => row.targetValue)
			.filter((id): id is string => typeof id === 'string' && id.length > 0)
	}

	/**
	 * Create a user blacklist entry
	 * Used for both manual blacklists and auto-blacklists triggered by characters
	 */
	async createUserBlacklist(params: CreateUserBlacklistParams): Promise<BlacklistEntry> {
		const existing = await this.ctx.db.query.blacklistEntries.findFirst({
			where: and(
				eq(blacklistEntries.targetType, 'user'),
				eq(blacklistEntries.targetValue, params.userId)
			),
		})

		if (existing) {
			await this.ensureDiscordUserBlacklist({
				discordUserId: params.discordUserId,
				blacklistedBy: params.blacklistedBy,
				triggeredBy: existing.id,
				userId: params.userId,
				metadata: params.metadata ?? null,
			})
			return this.mapToBlacklistEntry(existing)
		}

		const [entry] = await this.ctx.db
			.insert(blacklistEntries)
			.values({
				targetType: 'user',
				targetValue: params.userId,
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

		await this.ensureDiscordUserBlacklist({
			discordUserId: params.discordUserId,
			blacklistedBy: params.blacklistedBy,
			triggeredBy: entry.id,
			userId: params.userId,
			metadata: params.metadata ?? null,
		})

		return this.mapToBlacklistEntry(entry)
	}

	/**
	 * Create a character blacklist entry
	 * The Core worker will handle finding users with this character and auto-blacklisting them
	 */
	async createCharacterBlacklist(params: CreateCharacterBlacklistParams): Promise<BlacklistEntry> {
		const characterId = params.characterId?.trim()
		const characterName = params.characterName?.trim()
		const normalizedCharacterName = characterName ? this.normalizeCharacterName(characterName) : null
		if (!characterId && !normalizedCharacterName) {
			throw new Error('Either characterId or characterName is required')
		}

		const targetType = characterId ? 'character_id' : 'character_name'
		const targetValue = characterId ?? normalizedCharacterName ?? ''

		const existing = await this.ctx.db.query.blacklistEntries.findFirst({
			where: and(
				eq(blacklistEntries.targetType, targetType),
				eq(blacklistEntries.targetValue, targetValue)
			),
		})

		if (existing) {
			await this.ensureCharacterNameBlacklist({
				characterName,
				blacklistedBy: params.blacklistedBy,
				triggeredBy: existing.id,
				characterId: characterId ?? existing.targetValue,
				metadata: params.metadata ?? null,
			})
			return this.mapToBlacklistEntry(existing)
		}

		const [entry] = await this.ctx.db
			.insert(blacklistEntries)
			.values({
				targetType,
				targetValue,
				reason: params.reason,
				blacklistedBy: params.blacklistedBy,
				triggeredBy: params.triggeredBy ?? null,
				isAutoBlacklist: false,
				metadata: params.metadata ?? null,
			})
			.returning()

		if (!entry) {
			throw new Error('Failed to create character blacklist entry')
		}

		await this.ensureCharacterNameBlacklist({
			characterName,
			blacklistedBy: params.blacklistedBy,
			triggeredBy: entry.id,
			characterId: characterId ?? entry.targetValue,
			metadata: params.metadata ?? null,
		})

		return this.mapToBlacklistEntry(entry)
	}

	/**
	 * Create a Discord blacklist entry
	 */
	async createDiscordBlacklist(params: CreateDiscordBlacklistParams): Promise<BlacklistEntry> {
		const discordUserId = params.discordUserId.trim()
		if (!discordUserId) {
			throw new Error('discordUserId is required')
		}

		const existing = await this.ctx.db.query.blacklistEntries.findFirst({
			where: and(
				eq(blacklistEntries.targetType, 'discord_id'),
				eq(blacklistEntries.targetValue, discordUserId)
			),
		})

		if (existing) {
			return this.mapToBlacklistEntry(existing)
		}

		const [entry] = await this.ctx.db
			.insert(blacklistEntries)
			.values({
				targetType: 'discord_id',
				targetValue: discordUserId,
				reason: params.reason,
				blacklistedBy: params.blacklistedBy,
				triggeredBy: params.triggeredBy ?? null,
				isAutoBlacklist: false,
				metadata: params.metadata ?? null,
			})
			.returning()

		if (!entry) {
			throw new Error('Failed to create Discord blacklist entry')
		}

		return this.mapToBlacklistEntry(entry)
	}

	/**
	 * Remove a blacklist entry
	 */
	async removeBlacklistEntry(id: string): Promise<void> {
		await this.ctx.db.delete(blacklistEntries).where(eq(blacklistEntries.id, id))
	}

	/**
	 * Get all blacklist entries for a user (including auto-blacklists)
	 */
	async getBlacklistsForUser(userId: string): Promise<BlacklistEntry[]> {
		const entries = await this.ctx.db.query.blacklistEntries.findMany({
			where: and(eq(blacklistEntries.targetType, 'user'), eq(blacklistEntries.targetValue, userId)),
			orderBy: [desc(blacklistEntries.createdAt)],
		})

		return entries.map((e) => this.mapToBlacklistEntry(e))
	}

	/**
	 * Get all blacklist entries for a Discord user ID
	 */
	async getBlacklistsForDiscordUser(discordUserId: string): Promise<BlacklistEntry[]> {
		const entries = await this.ctx.db.query.blacklistEntries.findMany({
			where: and(
				eq(blacklistEntries.targetType, 'discord_id'),
				eq(blacklistEntries.targetValue, discordUserId)
			),
			orderBy: [desc(blacklistEntries.createdAt)],
		})

		return entries.map((e) => this.mapToBlacklistEntry(e))
	}

	/**
	 * Get all blacklist entries for a character
	 */
	async getBlacklistsForCharacter(characterId: string): Promise<BlacklistEntry[]> {
		const entries = await this.ctx.db.query.blacklistEntries.findMany({
			where: and(
				eq(blacklistEntries.targetType, 'character_id'),
				eq(blacklistEntries.targetValue, characterId)
			),
			orderBy: [desc(blacklistEntries.createdAt)],
		})

		return entries.map((e) => this.mapToBlacklistEntry(e))
	}

	/**
	 * Get all blacklist entries for a character name
	 */
	async getBlacklistsForCharacterName(characterName: string): Promise<BlacklistEntry[]> {
		const normalizedName = this.normalizeCharacterName(characterName)
		const entries = await this.ctx.db.query.blacklistEntries.findMany({
			where: and(
				eq(blacklistEntries.targetType, 'character_name'),
				eq(blacklistEntries.targetValue, normalizedName)
			),
			orderBy: [desc(blacklistEntries.createdAt)],
		})

		return entries.map((e) => this.mapToBlacklistEntry(e))
	}

	/**
	 * Get a specific blacklist entry by ID
	 */
	async getBlacklistEntry(id: string): Promise<BlacklistEntry | null> {
		const entry = await this.ctx.db.query.blacklistEntries.findFirst({
			where: eq(blacklistEntries.id, id),
		})

		return entry ? this.mapToBlacklistEntry(entry) : null
	}

	/**
	 * Get user blacklists triggered by a character blacklist
	 * Used to show "N users auto-blacklisted from this character"
	 */
	async getTriggeredBlacklists(characterBlacklistId: string): Promise<BlacklistEntry[]> {
		const entries = await this.ctx.db.query.blacklistEntries.findMany({
			where: eq(blacklistEntries.triggeredBy, characterBlacklistId),
			orderBy: [desc(blacklistEntries.createdAt)],
		})

		return entries.map((e) => this.mapToBlacklistEntry(e))
	}

	/**
	 * Find ALL blacklist entries triggered by a specific entry (for cascading removal)
	 */
	async findTriggeredEntries(blacklistId: string): Promise<BlacklistEntry[]> {
		const entry = await this.ctx.db.query.blacklistEntries.findFirst({
			where: eq(blacklistEntries.id, blacklistId),
			columns: {
				id: true,
				targetType: true,
				targetValue: true,
			},
		})

		const triggeredEntries = await this.ctx.db.query.blacklistEntries.findMany({
			where: eq(blacklistEntries.triggeredBy, blacklistId),
		})

		const allEntries = await this.ctx.db.query.blacklistEntries.findMany()
		const legacyTriggered = allEntries.filter((candidate) => {
			if (!candidate.metadata || candidate.triggeredBy) return false
			const metadata = candidate.metadata as Record<string, unknown>

			if (
				metadata.triggeredByUserBlacklist === blacklistId ||
				metadata.triggeredByCharacterId === blacklistId ||
				metadata.triggeredByDiscordUserId === blacklistId
			) {
				return true
			}

			if (
				entry?.targetType === 'user' &&
				typeof entry.targetValue === 'string' &&
				metadata.triggeredByUserBlacklist === entry.targetValue
			) {
				return true
			}

			return false
		})

		const seenIds = new Set<string>()
		const merged = [...triggeredEntries, ...legacyTriggered].filter((candidate) => {
			if (seenIds.has(candidate.id)) return false
			seenIds.add(candidate.id)
			return true
		})

		return merged.map((e) => this.mapToBlacklistEntry(e))
	}

	/**
	 * List all blacklist entries with filters and pagination
	 */
	async getAllBlacklists(filters: BlacklistFilters = {}): Promise<BlacklistResults> {
		const limit = filters.limit ?? 50
		const offset = filters.offset ?? 0
		const conditions = []

		if (filters.targetType) {
			conditions.push(eq(blacklistEntries.targetType, filters.targetType))
		}

		if (filters.isAutoBlacklist !== undefined) {
			conditions.push(eq(blacklistEntries.isAutoBlacklist, filters.isAutoBlacklist))
		}

		if (filters.targetValue) {
			conditions.push(eq(blacklistEntries.targetValue, filters.targetValue))
		}
		if (filters.search?.trim()) {
			const search = `%${filters.search.trim()}%`
			conditions.push(
				or(
					ilike(blacklistEntries.targetValue, search),
					ilike(blacklistEntries.reason, search),
					sql`${blacklistEntries.targetType}::text ilike ${search}`,
				)
			)
		}

		const whereClause = conditions.length > 0 ? and(...conditions) : undefined

		const entries = await this.ctx.db.query.blacklistEntries.findMany({
			where: whereClause,
			orderBy: [desc(blacklistEntries.createdAt)],
			limit,
			offset,
		})

		const totalResult = await this.ctx.db
			.select({ count: blacklistEntries.id })
			.from(blacklistEntries)
			.where(whereClause ?? undefined)

		return {
			entries: entries.map((e) => this.mapToBlacklistEntry(e)),
			total: totalResult.length,
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
			targetValue: row.targetValue,
			reason: row.reason,
			blacklistedBy: row.blacklistedBy,
			triggeredBy: row.triggeredBy,
			isAutoBlacklist: row.isAutoBlacklist,
			metadata: row.metadata,
			createdAt: row.createdAt,
		}
	}

	private async ensureDiscordUserBlacklist(params: {
		discordUserId?: string
		blacklistedBy: string
		triggeredBy: string
		userId: string
		metadata: Record<string, unknown> | null
	}): Promise<void> {
		if (!params.discordUserId) return

		const existingDiscordEntry = await this.ctx.db.query.blacklistEntries.findFirst({
			where: and(
				eq(blacklistEntries.targetType, 'discord_id'),
				eq(blacklistEntries.targetValue, params.discordUserId)
			),
			columns: { id: true },
		})

		if (existingDiscordEntry) return

		await this.ctx.db.insert(blacklistEntries).values({
			targetType: 'discord_id',
			targetValue: params.discordUserId,
			reason: `Auto-blacklisted: linked to blacklisted user ${params.userId}`,
			blacklistedBy: params.blacklistedBy,
			triggeredBy: params.triggeredBy,
			isAutoBlacklist: true,
			metadata: {
				...(params.metadata ?? {}),
				triggeredByUser: params.userId,
			},
		})
	}

	private async ensureCharacterNameBlacklist(params: {
		characterName?: string
		blacklistedBy: string
		triggeredBy: string
		characterId: string
		metadata: Record<string, unknown> | null
	}): Promise<void> {
		if (!params.characterName) return
		const normalizedName = this.normalizeCharacterName(params.characterName)
		if (!normalizedName) return

		const existingNameEntry = await this.ctx.db.query.blacklistEntries.findFirst({
			where: and(
				eq(blacklistEntries.targetType, 'character_name'),
				eq(blacklistEntries.targetValue, normalizedName)
			),
			columns: { id: true },
		})

		if (existingNameEntry) return

		await this.ctx.db.insert(blacklistEntries).values({
			targetType: 'character_name',
			targetValue: normalizedName,
			reason: `Auto-blacklisted: linked to blacklisted character ID ${params.characterId}`,
			blacklistedBy: params.blacklistedBy,
			triggeredBy: params.triggeredBy,
			isAutoBlacklist: true,
			metadata: {
				...(params.metadata ?? {}),
				originalCharacterName: params.characterName,
				triggeredByCharacterId: params.characterId,
			},
		})
	}
}
