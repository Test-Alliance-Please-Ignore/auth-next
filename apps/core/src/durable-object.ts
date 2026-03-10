import { DurableObject } from 'cloudflare:workers'

import { CORE_ROLES, SERVICE_CORE } from '@repo/core'
import { and, asc, eq, inArray, isNull, lt, or } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

import { createDb } from './db'
import { userCharacters, users } from './db/schema'

import type { Core } from '@repo/core'
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
			void this.ensureRolesExist()
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
		try {
			await groupsStub.batchCreateRoles({ roles })
			this.logger.info('Groups roles created.', { roles })
		} catch (_error) {
			/* empty catch */
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
	): Promise<Array<{ characterId: string; characterName: string; isDeleted: boolean }>> {
		const characters = await this.getDb().query.userCharacters.findMany({
			where: and(eq(userCharacters.isDeleted, includeDeleted), eq(userCharacters.userId, userId)),
		})
		return characters.map((c) => ({
			characterId: c.characterId,
			characterName: c.characterName,
			isDeleted: c.isDeleted,
		}))
	}

	async getUserCorporations(
		userId: string
	): Promise<Array<{ corporationId: string; corporationName: string }>> {
		const characters = await this.getDb().query.userCharacters.findMany({
			where: and(eq(userCharacters.userId, userId), eq(userCharacters.isDeleted, false)),
		})

		return characters
			.filter((char) => char.corporationId !== null)
			.map((char) => ({
				corporationId: char.corporationId!,
				corporationName: char.corporationName ?? char.corporationId!,
			}))
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
			where: and(inArray(userCharacters.userId, userIds), eq(userCharacters.isDeleted, false)),
		})

		// Group characters by userId
		const charactersByUser = new Map<string, Array<(typeof allCharacters)[number]>>()
		for (const char of allCharacters) {
			if (!charactersByUser.has(char.userId)) {
				charactersByUser.set(char.userId, [])
			}
			charactersByUser.get(char.userId)!.push(char)
		}

		// Build result map
		for (const userId of userIds) {
			const chars = charactersByUser.get(userId) || []
			const corporations: Array<{ corporationId: string; corporationName: string }> = []

			for (const char of chars) {
				if (char.corporationId) {
					corporations.push({
						corporationId: char.corporationId,
						corporationName: char.corporationName ?? char.corporationId,
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
		const characters = await this.getDb().query.userCharacters.findMany({
			where: and(eq(userCharacters.userId, userId), eq(userCharacters.isDeleted, false)),
		})

		return characters
			.filter((char) => char.allianceId !== null)
			.map((char) => ({
				allianceId: char.allianceId!,
				allianceName: char.allianceName ?? char.allianceId!,
			}))
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
