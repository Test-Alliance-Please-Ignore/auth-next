import { DurableObject } from 'cloudflare:workers'

import { CORE_ROLES, SERVICE_CORE } from '@repo/core'
import { and, asc, eq, inArray, isNull, lt, or } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'
import { getEsiInstanceForCharacter, getEsiInstanceForCorporation } from '@repo/esi'
import { logger } from '@repo/hono-helpers'

import { createDb } from './db'
import { userCharacters, users } from './db/schema'

import type { Core } from '@repo/core'
import type { CharacterPublicInfo } from '@repo/esi'
import type { CreateRoleRequest, Groups } from '@repo/groups'
import type { Env } from './context'

export class CoreDO extends DurableObject<Env> implements Core {
	private readonly logger = logger.withTags({ service: 'core-durable-object' })
	constructor(
		public state: DurableObjectState,
		public env: Env
	) {
		super(state, env)

		void this.state.blockConcurrencyWhile(async () => {
			await this.ensureRolesExist()
		})
	}

	private getDb(): ReturnType<typeof createDb> {
		return createDb(this.env.DATABASE_URL)
	}

	private async ensureRolesExist(): Promise<void> {
		const roles = CORE_ROLES.map((role) => ({
			name: role,
			ownedBy: SERVICE_CORE,
			description: `${role} role for the HR system`,
		})) as CreateRoleRequest[]

		const groupsStub = getStub<Groups>(this.env.GROUPS, 'default')
		const maxAttempts = 5
		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			try {
				await groupsStub.batchCreateRoles({ roles })
				this.logger.info('Groups roles created.', { roles, attempt })
				return
			} catch (error) {
				this.logger.error('Failed to seed core roles.', {
					attempt,
					maxAttempts,
					error: error instanceof Error ? error.message : String(error),
				})
				if (attempt === maxAttempts) {
					throw error
				}
				const backoffMs = Math.min(250 * 2 ** (attempt - 1), 2000)
				await new Promise((resolve) => setTimeout(resolve, backoffMs))
			}
		}
	}

	private async getCharacterInfo(characterId: string): Promise<CharacterPublicInfo | null> {
		const instance = getEsiInstanceForCharacter(this.env.ESI, characterId)
		const characterInfo = await instance.fetchCharacterPublicInfo(characterId)
		return characterInfo
	}

	private async getCharacterAllianceInfo(
		characterId: string
	): Promise<{ allianceId: string; allianceName: string } | null> {
		const characterInfo = await this.getCharacterInfo(characterId)
		if (!characterInfo) {
			return null
		}
		const instance = getEsiInstanceForCorporation(this.env.ESI, characterInfo.corporation_id)
		const corporationInfo = await instance.fetchCorporationPublicInfo(characterInfo.corporation_id)

		if (!corporationInfo.alliance_id) {
			return null
		}

		return {
			allianceId: String(corporationInfo.alliance_id),
			allianceName: corporationInfo.name,
		}
	}

	async getCharacterOwner(
		characterId: string
	): Promise<{ userId: string; isPrimary: boolean } | null> {
		const character = await this.getDb().query.userCharacters.findFirst({
			where: eq(userCharacters.characterId, characterId),
		})
		if (!character) {
			return null
		}

		return { userId: character.userId, isPrimary: character.is_primary }
	}
	async getUserCharacters(
		userId: string,
		includeDeleted: boolean = false
	): Promise<
		Array<{
			characterId: string
			characterName: string
			isDeleted: boolean
			corporationId?: string | null
			corporationName?: string | null
			allianceId?: string | null
			allianceName?: string | null
		}>
	> {
		const characters = await this.getDb().query.userCharacters.findMany({
			where: and(eq(userCharacters.isDeleted, includeDeleted), eq(userCharacters.userId, userId)),
		})
		return characters.map((c) => ({
			characterId: c.characterId,
			characterName: c.characterName,
			isDeleted: c.isDeleted,
			corporationId: c.corporationId,
			corporationName: c.corporationName,
			allianceId: c.allianceId,
			allianceName: c.allianceName,
		}))
	}

	async getUserCorporations(
		userId: string
	): Promise<Array<{ corporationId: string; corporationName: string }>> {
		const user = await this.getDb().query.users.findFirst({
			where: eq(users.id, userId),
		})

		if (!user) {
			return []
		}

		const characters = await this.getDb().query.userCharacters.findMany({
			where: eq(userCharacters.userId, userId),
		})

		const corporations = (
			await Promise.all(
				characters.map(async (c) => {
					try {
						const characterInfo = await this.getCharacterInfo(c.characterId)
						if (!characterInfo) {
							return null
						}
						return {
							corporationId: characterInfo.corporation_id,
							corporationName: characterInfo.name,
						}
					} catch (error) {
						// One bad/expired character token must not break the entire user's
						// auth/session flow. Skipping is safe because this only omits
						// character-derived corporation context; it never grants extra access.
						this.logger.warn('Skipping character during corporation resolution', {
							userId,
							characterId: c.characterId,
							error: error instanceof Error ? error.message : String(error),
						})
						return null
					}
				})
			)
		).filter((c): c is NonNullable<typeof c> => c !== null)

		return corporations
	}

	async getUserCorporationsBatch(
		userIds: string[]
	): Promise<Map<string, Array<{ corporationId: string; corporationName: string }>>> {
		const result = new Map<string, Array<{ corporationId: string; corporationName: string }>>()

		if (userIds.length === 0) {
			return result
		}

		// Batch fetch all user characters
		const allCharacters = await this.getDb().query.userCharacters.findMany({
			where: inArray(userCharacters.userId, userIds),
		})

		// Group characters by userId
		const charactersByUser = new Map<string, Array<(typeof allCharacters)[number]>>()
		for (const char of allCharacters) {
			if (!charactersByUser.has(char.userId)) {
				charactersByUser.set(char.userId, [])
			}
			charactersByUser.get(char.userId)!.push(char)
		}

		// Fetch character info for all characters in parallel
		const allCharacterIds = allCharacters.map((c) => c.characterId)
		const characterInfoMap = new Map<string, CharacterPublicInfo>()

		await Promise.all(
			allCharacterIds.map(async (characterId) => {
				try {
					const info = await this.getCharacterInfo(characterId)
					if (info) {
						characterInfoMap.set(characterId, info)
					}
				} catch (error) {
					// Partial-failure behavior: preserve permissions/auth for healthy
					// characters and skip only unresolved entries. This is fail-closed
					// for authorization (missing context can reduce permissions, not expand).
					this.logger.warn('Skipping character during batch corporation resolution', {
						characterId,
						error: error instanceof Error ? error.message : String(error),
					})
				}
			})
		)

		// Build result map
		for (const userId of userIds) {
			const chars = charactersByUser.get(userId) || []
			const corporations: Array<{ corporationId: string; corporationName: string }> = []

			for (const char of chars) {
				const info = characterInfoMap.get(char.characterId)
				if (info) {
					corporations.push({
						corporationId: info.corporation_id,
						corporationName: info.name,
					})
				}
			}

			result.set(userId, corporations)
		}

		return result
	}

	async getUserAlliances(
		userId: string
	): Promise<Array<{ allianceId: string; allianceName: string }>> {
		const user = await this.getDb().query.users.findFirst({
			where: eq(users.id, userId),
		})

		if (!user) {
			return []
		}

		const characters = await this.getDb().query.userCharacters.findMany({
			where: eq(userCharacters.userId, userId),
		})

		const alliances = await Promise.all(
			characters.map(async (c) => {
				try {
					const allianceInfo = await this.getCharacterAllianceInfo(c.characterId)
					if (!allianceInfo) {
						return null
					}
					return allianceInfo
				} catch (error) {
					// Same safety rule as corporation resolution: avoid cascading failure
					// from one invalid character token, while never elevating access.
					this.logger.warn('Skipping character during alliance resolution', {
						userId,
						characterId: c.characterId,
						error: error instanceof Error ? error.message : String(error),
					})
					return null
				}
			})
		)

		return alliances.filter((a): a is NonNullable<typeof a> => a !== null)
	}

	async getUserDiscordUserId(userId: string): Promise<string | null> {
		throw new Error('Not implemented')
	}

	async listUsersNeedingRefresh(maxResults: number): Promise<string[]> {
		const limit = Number.isFinite(maxResults) ? Math.floor(maxResults) : 0
		if (limit <= 0) {
			return []
		}

		const now = Date.now()
		const refreshThreshold = new Date(now - 60 * 60 * 1000) // 1 hour
		const attemptThreshold = new Date(now - 10 * 60 * 1000) // 10 minutes

		const candidates = await this.getDb().query.users.findMany({
			columns: {
				id: true,
			},
			where: and(
				or(isNull(users.lastRefreshWorkflow), lt(users.lastRefreshWorkflow, refreshThreshold)),
				or(
					isNull(users.lastRefreshWorkflowAttempt),
					lt(users.lastRefreshWorkflowAttempt, attemptThreshold)
				)
			),
			orderBy: (table) => [asc(table.lastRefreshWorkflow)],
			limit,
		})

		if (candidates.length === 0) {
			return []
		}

		const userIds = candidates.map((candidate) => candidate.id)
		await this.getDb()
			.update(users)
			.set({ lastRefreshWorkflowAttempt: new Date() })
			.where(inArray(users.id, userIds))

		return userIds
	}
}
