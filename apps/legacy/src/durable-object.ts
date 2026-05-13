import { DurableObject } from 'cloudflare:workers'

import { getStub } from '@repo/do-utils'
import { and, asc, desc, eq, ilike, inArray, ne, notInArray, or, sql } from '@repo/db-utils'
import { createDb } from './db'
import { coreUserCharacters, coreUsers } from './db/schema-core'
import {
	legacyAuthApplicationEvents,
	legacyAuthApplications,
	legacyAuthCharacters,
	legacyAuthDiscordAccounts,
	legacyAuthNotes,
	legacyAuthUserIpAddresses,
	legacyMigrationActions,
	legacyMigrationQueue,
} from './db/schema'

import type { Legacy, LegacyMigrationQueueItem } from '@repo/legacy'
import type { Core } from '@repo/core'
import type { Env } from './context'

export class LegacyDO extends DurableObject<Env> implements Legacy {
	private db = createDb(this.env.DATABASE_URL)

	private parseSnapshot(
		value: unknown
	): {
		matchingCharacterIds: Set<string>
		matchingDiscordUserIds: Set<string>
		associatedCounts: {
			characters: number
			ipAddresses: number
			notes: number
			applications: number
			discordAccounts: number
		}
	} {
		const obj = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
		const matchingCharacters = Array.isArray(obj.matchingCharacters) ? obj.matchingCharacters : []
		const matchingDiscordAccounts = Array.isArray(obj.matchingDiscordAccounts) ? obj.matchingDiscordAccounts : []
		const associatedCounts =
			obj.associatedCounts && typeof obj.associatedCounts === 'object'
				? (obj.associatedCounts as Record<string, unknown>)
				: {}

		return {
			matchingCharacterIds: new Set(
				matchingCharacters
					.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
					.map((entry) => String(entry.characterId ?? ''))
					.filter(Boolean)
			),
			matchingDiscordUserIds: new Set(
				matchingDiscordAccounts
					.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
					.map((entry) => String(entry.discordUserId ?? ''))
					.filter(Boolean)
			),
			associatedCounts: {
				characters: Number(associatedCounts.characters ?? 0),
				ipAddresses: Number(associatedCounts.ipAddresses ?? 0),
				notes: Number(associatedCounts.notes ?? 0),
				applications: Number(associatedCounts.applications ?? 0),
				discordAccounts: Number(associatedCounts.discordAccounts ?? 0),
			},
		}
	}

	private parseConflicts(value: unknown): {
		multipleLegacyUsersForModernUser: boolean
		crossModernUserQueueMatchesCount: number
	} {
		const obj = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
		const crossMatches = Array.isArray(obj.crossModernUserQueueMatches) ? obj.crossModernUserQueueMatches : []
		return {
			multipleLegacyUsersForModernUser: Boolean(obj.multipleLegacyUsersForModernUser),
			crossModernUserQueueMatchesCount: crossMatches.length,
		}
	}

	private hasMaterialNewFindings(input: {
		existingSnapshot: unknown
		existingConflicts: unknown
		nextSnapshot: Record<string, unknown>
		nextConflicts: Record<string, unknown>
	}): boolean {
		const existing = this.parseSnapshot(input.existingSnapshot)
		const next = this.parseSnapshot(input.nextSnapshot)
		const existingConflicts = this.parseConflicts(input.existingConflicts)
		const nextConflicts = this.parseConflicts(input.nextConflicts)

		for (const characterId of next.matchingCharacterIds) {
			if (!existing.matchingCharacterIds.has(characterId)) return true
		}
		for (const discordUserId of next.matchingDiscordUserIds) {
			if (!existing.matchingDiscordUserIds.has(discordUserId)) return true
		}

		if (next.associatedCounts.characters > existing.associatedCounts.characters) return true
		if (next.associatedCounts.ipAddresses > existing.associatedCounts.ipAddresses) return true
		if (next.associatedCounts.notes > existing.associatedCounts.notes) return true
		if (next.associatedCounts.applications > existing.associatedCounts.applications) return true
		if (next.associatedCounts.discordAccounts > existing.associatedCounts.discordAccounts) return true

		if (
			nextConflicts.crossModernUserQueueMatchesCount > existingConflicts.crossModernUserQueueMatchesCount
		) {
			return true
		}
		if (
			nextConflicts.multipleLegacyUsersForModernUser &&
			!existingConflicts.multipleLegacyUsersForModernUser
		) {
			return true
		}

		return false
	}

	async fetch(_request: Request): Promise<Response> {
		return new Response('Legacy Durable Object RPC endpoint', { status: 200 })
	}

	private async getCoreAdminUserDetails(targetUserId: string): Promise<{
		id: string
		characters: Array<{ characterId: string }>
		discordUserId?: string | null
	} | null> {
		const coreStub = getStub<Core>(this.env.CORE, 'default')
		const [characters, discordUserId] = await Promise.all([
			coreStub.getUserCharacters(targetUserId, false),
			coreStub.getUserDiscordUserId(targetUserId),
		])
		if (characters.length === 0) return null
		return {
			id: targetUserId,
			characters: characters.map((character) => ({ characterId: character.characterId })),
			discordUserId,
		}
	}

	async resolveLegacyActorCharacterNames(legacyAuthUserIds: string[]): Promise<Record<string, string>> {
		const uniqueIds = [...new Set(legacyAuthUserIds.filter(Boolean))]
		if (uniqueIds.length === 0) return {}

		const actorCharacters = await this.db.query.legacyAuthCharacters.findMany({
			where: inArray(legacyAuthCharacters.legacyAuthUserId, uniqueIds),
			columns: {
				legacyAuthUserId: true,
				characterName: true,
				source: true,
				sourceSnapshotAt: true,
			},
		})
		const actorLegacyCharacterNames: Record<string, string> = {}
		for (const legacyAuthUserId of uniqueIds) {
			const rows = actorCharacters.filter((row) => row.legacyAuthUserId === legacyAuthUserId)
			if (rows.length === 0) continue

			const primaryRows = rows
				.filter((row) => row.source === 'legacy_primary')
				.sort((a, b) => {
					const aTime = a.sourceSnapshotAt ? new Date(a.sourceSnapshotAt).getTime() : 0
					const bTime = b.sourceSnapshotAt ? new Date(b.sourceSnapshotAt).getTime() : 0
					return bTime - aTime
				})
			if (primaryRows.length > 0) {
				actorLegacyCharacterNames[legacyAuthUserId] = primaryRows[0].characterName
				continue
			}

			const esiOwnerNames = [
				...new Set(
					rows
						.filter((row) => row.source === 'esi_owner')
						.map((row) => row.characterName)
				),
			]
			if (esiOwnerNames.length === 1) {
				actorLegacyCharacterNames[legacyAuthUserId] = esiOwnerNames[0]
				continue
			}

			const allUniqueNames = [...new Set(rows.map((row) => row.characterName))]
			if (allUniqueNames.length === 1) {
				actorLegacyCharacterNames[legacyAuthUserId] = allUniqueNames[0]
			}
		}
		return actorLegacyCharacterNames
	}

	async listMigrations(filters: {
		page: number
		pageSize: number
		status?: 'pending' | 'partially_applied' | 'applied' | 'dismissed' | 'error'
		modernUserId?: string
		legacyAuthUserId?: string
	}) {
		const where = []
		if (filters.status) where.push(eq(legacyMigrationQueue.status, filters.status))
		if (filters.modernUserId) where.push(eq(legacyMigrationQueue.modernUserId, filters.modernUserId))
		if (filters.legacyAuthUserId) where.push(eq(legacyMigrationQueue.legacyAuthUserId, filters.legacyAuthUserId))
		const whereClause = where.length > 0 ? and(...where) : undefined
		const offset = (filters.page - 1) * filters.pageSize

		const [rows, totalRows] = await Promise.all([
			this.db.query.legacyMigrationQueue.findMany({
				where: whereClause,
				orderBy: [desc(legacyMigrationQueue.updatedAt), desc(legacyMigrationQueue.createdAt)],
				limit: filters.pageSize,
				offset,
			}),
			this.db
				.select({ count: sql<number>`count(*)::int` })
				.from(legacyMigrationQueue)
				.where(whereClause ?? sql`true`),
		])
		const total = totalRows[0]?.count ?? 0
		const modernUserIds = [...new Set(rows.map((row) => row.modernUserId))]
		const userRows =
			modernUserIds.length > 0
				? await this.db.query.coreUsers.findMany({
						where: inArray(coreUsers.id, modernUserIds),
						columns: { id: true, mainCharacterId: true },
					})
				: []
		const mainCharacterIds = userRows.map((row) => row.mainCharacterId).filter((v): v is string => Boolean(v))
		const mainCharacterRows =
			mainCharacterIds.length > 0
				? await this.db.query.coreUserCharacters.findMany({
						where: inArray(coreUserCharacters.characterId, mainCharacterIds),
						columns: { characterId: true, characterName: true },
					})
				: []
		const mainCharacterNameById = new Map(
			mainCharacterRows.map((row) => [row.characterId, row.characterName ?? null])
		)
		const mainCharacterIdByUserId = new Map(userRows.map((row) => [row.id, row.mainCharacterId ?? null]))
		const enrichedRows = rows.map((row) => ({
			...row,
			modernUserMainCharacterName:
				mainCharacterIdByUserId.get(row.modernUserId) != null
					? (mainCharacterNameById.get(mainCharacterIdByUserId.get(row.modernUserId) as string) ?? null)
					: null,
		}))

		return {
			items: enrichedRows as LegacyMigrationQueueItem[],
			pagination: {
				page: filters.page,
				pageSize: filters.pageSize,
				total,
				totalPages: Math.max(1, Math.ceil(total / filters.pageSize)),
			},
		}
	}

	async getMigration(id: string) {
		const item = await this.db.query.legacyMigrationQueue.findFirst({
			where: eq(legacyMigrationQueue.id, id),
		})
		if (!item) return null
		const actions = await this.db.query.legacyMigrationActions.findMany({
			where: eq(legacyMigrationActions.queueId, id),
			orderBy: [asc(legacyMigrationActions.createdAt)],
		})
		const [characters, notes, ipAddresses] = await Promise.all([
			this.db.query.legacyAuthCharacters.findMany({
				where: eq(legacyAuthCharacters.legacyAuthUserId, item.legacyAuthUserId),
				columns: { characterId: true, characterName: true, source: true },
			}),
			this.db.query.legacyAuthNotes.findMany({
				where: eq(legacyAuthNotes.legacyAuthUserId, item.legacyAuthUserId),
				columns: {
					legacyNoteId: true,
					note: true,
					legacyCreatedByUserId: true,
					legacyDateCreated: true,
				},
			}),
			this.db.query.legacyAuthUserIpAddresses.findMany({
				where: eq(legacyAuthUserIpAddresses.legacyAuthUserId, item.legacyAuthUserId),
				columns: { ipAddress: true },
			}),
		])
		const linkedRows =
			characters.length > 0
				? await this.db.query.coreUserCharacters.findMany({
						where: inArray(
							coreUserCharacters.characterId,
							characters.map((character) => character.characterId)
						),
						columns: {
							characterId: true,
							characterName: true,
							userId: true,
							corporationId: true,
							corporationName: true,
							allianceId: true,
							allianceName: true,
							isDeleted: true,
						},
					})
				: []
		const noteActorIds = [
			...new Set(notes.map((note) => note.legacyCreatedByUserId).filter((id): id is string => Boolean(id))),
		]
		const noteActorNames = await this.resolveLegacyActorCharacterNames(noteActorIds)
		const coreStub = getStub<Core>(this.env.CORE, 'default')
		const importedLegacyNoteIds = new Set(
			await coreStub.getImportedLegacyNoteIdsForUser(
				item.modernUserId,
				notes.map((note) => note.legacyNoteId)
			)
		)
		const linkedByCharacterId = new Map(linkedRows.map((row) => [row.characterId, row.userId]))
		const linkedRowByCharacterId = new Map(linkedRows.map((row) => [row.characterId, row]))
		const metadataCharacterIds = characters
			.filter((character) => linkedByCharacterId.get(character.characterId) !== item.modernUserId)
			.map((character) => character.characterId)
		const characterMetadataRows = await coreStub.getLegacyCharacterImportMetadata(metadataCharacterIds)
		const characterMetadataById = new Map(
			characterMetadataRows.map((row) => [row.characterId, row])
		)
		const candidates = {
			characters: characters.map((character) => {
				const linkedUserId = linkedByCharacterId.get(character.characterId) ?? null
				const linkedRow = linkedRowByCharacterId.get(character.characterId)
				const metadata =
					linkedUserId === item.modernUserId
						? {
							characterName: linkedRow?.characterName ?? character.characterName,
							corporationId: linkedRow?.corporationId ?? null,
							corporationName: linkedRow?.corporationName ?? null,
							allianceId: linkedRow?.allianceId ?? null,
							allianceName: linkedRow?.allianceName ?? null,
							isDeleted: linkedRow?.isDeleted ?? false,
						}
						: characterMetadataById.get(character.characterId)
				return {
					characterId: character.characterId,
					characterName: metadata?.characterName ?? character.characterName,
					source: character.source,
					corporationId: metadata?.corporationId ?? null,
					corporationName: metadata?.corporationName ?? null,
					allianceId: metadata?.allianceId ?? null,
					allianceName: metadata?.allianceName ?? null,
					isDeleted: metadata?.isDeleted ?? false,
					alreadyLinkedToModernUser: linkedUserId === item.modernUserId,
					linkedToOtherUserId: linkedUserId && linkedUserId !== item.modernUserId ? linkedUserId : null,
				}
			}),
			notes: notes.map((note) => ({
				legacyNoteId: note.legacyNoteId,
				note: note.note,
				legacyCreatedByUserId: note.legacyCreatedByUserId ?? null,
				legacyCreatedByCharacterName:
					note.legacyCreatedByUserId ? (noteActorNames[note.legacyCreatedByUserId] ?? null) : null,
				legacyDateCreated: note.legacyDateCreated ?? null,
				alreadyImported: importedLegacyNoteIds.has(note.legacyNoteId),
			})),
			ipAddresses: ipAddresses.map((entry) => entry.ipAddress),
		}
		return { item, actions, candidates }
	}

	async applyMigration(id: string, payload?: Record<string, unknown>) {
		const existing = await this.db.query.legacyMigrationQueue.findFirst({
			where: eq(legacyMigrationQueue.id, id),
		})
		if (!existing) return null
		const coreStub = getStub<Core>(this.env.CORE, 'default')

		const applyResults: Record<string, { status: 'applied' | 'skipped' | 'error'; message?: string }> = {}
		const applyBlacklistToUser = Boolean(payload?.applyBlacklistToUser)
		const importCharacterLinks = Boolean(payload?.importCharacterLinks)
		const importNotes = Boolean(payload?.importNotes)
		const importIpAssociations = Boolean(payload?.importIpAssociations)
		const markSkipped = Boolean(payload?.markSkipped)
		const selectedCharacterIds = Array.isArray(payload?.characterIds)
			? new Set(payload.characterIds.filter((value): value is string => typeof value === 'string'))
			: null
		const selectedNoteIds = Array.isArray(payload?.noteIds)
			? new Set(payload.noteIds.filter((value): value is string => typeof value === 'string'))
			: null
		const selectedIpAddresses = Array.isArray(payload?.ipAddresses)
			? new Set(payload.ipAddresses.filter((value): value is string => typeof value === 'string'))
			: null
		const performedByUserId =
			typeof payload?.performedByUserId === 'string' ? payload.performedByUserId : 'system:legacy'

		if (applyBlacklistToUser) {
			try {
				await coreStub.createUserBlacklist({
					userId: existing.modernUserId,
					reason:
						typeof payload?.blacklistReason === 'string'
							? payload.blacklistReason
							: `Legacy migration blacklist action for legacy user ${existing.legacyAuthUserId}`,
					blacklistedBy: performedByUserId,
					metadata: {
						source: 'legacy_migration_apply',
						queueId: existing.id,
						legacyAuthUserId: existing.legacyAuthUserId,
						...(typeof payload?.blacklistMetadata === 'object' && payload.blacklistMetadata
							? payload.blacklistMetadata
							: {}),
					},
				})
				applyResults.applyBlacklistToUser = { status: 'applied' }
			} catch (error) {
				applyResults.applyBlacklistToUser = {
					status: 'error',
					message: error instanceof Error ? error.message : 'Blacklist request failed',
				}
			}
		} else {
			applyResults.applyBlacklistToUser = { status: 'skipped' }
		}

		if (importCharacterLinks) {
			const allCharacters = await this.db.query.legacyAuthCharacters.findMany({
				where: eq(legacyAuthCharacters.legacyAuthUserId, existing.legacyAuthUserId),
				columns: { characterId: true, characterName: true, source: true },
			})
			const characters =
				selectedCharacterIds && selectedCharacterIds.size > 0
					? allCharacters.filter((character) => selectedCharacterIds.has(character.characterId))
					: allCharacters
			const characterMetadataRows = await coreStub.getLegacyCharacterImportMetadata(
				characters.map((character) => character.characterId)
			)
			const characterMetadataById = new Map(
				characterMetadataRows.map((row) => [row.characterId, row])
			)
			const importableCharacters = characters.filter((character) => {
				const metadata = characterMetadataById.get(character.characterId)
				return !metadata?.isDeleted
			})
			try {
				await coreStub.legacyImportCharacterLinks({
					modernUserId: existing.modernUserId,
					legacyAuthUserId: existing.legacyAuthUserId,
					characters: importableCharacters,
				})
				applyResults.importCharacterLinks = { status: 'applied' }
			} catch (error) {
				applyResults.importCharacterLinks = {
					status: 'error',
					message: error instanceof Error ? error.message : 'Character-link import failed',
				}
			}
		} else {
			applyResults.importCharacterLinks = { status: 'skipped' }
		}

		if (importNotes) {
			const allNotes = await this.db.query.legacyAuthNotes.findMany({
				where: eq(legacyAuthNotes.legacyAuthUserId, existing.legacyAuthUserId),
			})
			const notes =
				selectedNoteIds && selectedNoteIds.size > 0
					? allNotes.filter((note) => selectedNoteIds.has(note.legacyNoteId))
					: allNotes
			try {
				await coreStub.legacyImportNotes({
					modernUserId: existing.modernUserId,
					legacyAuthUserId: existing.legacyAuthUserId,
					actorUserId: performedByUserId,
					notes: notes.map((note) => ({
						legacyNoteId: note.legacyNoteId,
						note: note.note,
						legacyCreatedByUserId: note.legacyCreatedByUserId,
						legacyDateCreated: note.legacyDateCreated ? note.legacyDateCreated.toISOString() : null,
						metadata: note.metadata ?? {},
					})),
				})
				applyResults.importNotes = { status: 'applied' }
			} catch (error) {
				applyResults.importNotes = {
					status: 'error',
					message: error instanceof Error ? error.message : 'Notes import failed',
				}
			}
		} else {
			applyResults.importNotes = { status: 'skipped' }
		}

		if (importIpAssociations) {
			const allIps = await this.db.query.legacyAuthUserIpAddresses.findMany({
				where: eq(legacyAuthUserIpAddresses.legacyAuthUserId, existing.legacyAuthUserId),
				columns: { ipAddress: true, firstSeenAt: true, lastSeenAt: true },
			})
			const selectedIps =
				selectedIpAddresses && selectedIpAddresses.size > 0
					? allIps.filter((entry) => selectedIpAddresses.has(entry.ipAddress))
					: allIps
			const SHARED_LEGACY_IP_USER_THRESHOLD = 10
			const candidateIpValues = [...new Set(selectedIps.map((entry) => entry.ipAddress).filter(Boolean))]
			const sharedIpRows =
				candidateIpValues.length > 0
					? await this.db
							.select({
								ipAddress: legacyAuthUserIpAddresses.ipAddress,
								sharedLegacyUserCount: sql<number>`count(distinct ${legacyAuthUserIpAddresses.legacyAuthUserId})::int`,
							})
							.from(legacyAuthUserIpAddresses)
							.where(inArray(legacyAuthUserIpAddresses.ipAddress, candidateIpValues))
							.groupBy(legacyAuthUserIpAddresses.ipAddress)
					: []
			const sharedCountByIp = new Map(
				sharedIpRows.map((row) => [row.ipAddress, Number(row.sharedLegacyUserCount)])
			)
			const ips = selectedIps.filter((entry) => {
				const sharedCount = sharedCountByIp.get(entry.ipAddress) ?? 0
				return sharedCount <= SHARED_LEGACY_IP_USER_THRESHOLD
			})
			try {
				await coreStub.legacyImportIpAssociations({
					modernUserId: existing.modernUserId,
					legacyAuthUserId: existing.legacyAuthUserId,
					ipAddresses: ips.map((entry) => ({
						ipAddress: entry.ipAddress,
						firstSeenAt: entry.firstSeenAt ? entry.firstSeenAt.toISOString() : null,
						lastSeenAt: entry.lastSeenAt ? entry.lastSeenAt.toISOString() : null,
					})),
				})
				applyResults.importIpAssociations = { status: 'applied' }
			} catch (error) {
				applyResults.importIpAssociations = {
					status: 'error',
					message: error instanceof Error ? error.message : 'IP import failed',
				}
			}
		} else {
			applyResults.importIpAssociations = { status: 'skipped' }
		}

		applyResults.markSkipped = markSkipped
			? { status: 'applied', message: 'Marked as reviewed with skip intent' }
			: { status: 'skipped' }

		const selectedActionCount = [
			applyBlacklistToUser,
			importCharacterLinks,
			importNotes,
			importIpAssociations,
			markSkipped,
		].filter(Boolean).length
		const appliedCount = Object.values(applyResults).filter((r) => r.status === 'applied').length
		const errorCount = Object.values(applyResults).filter((r) => r.status === 'error').length

		const nextStatus: 'applied' | 'partially_applied' | 'error' =
			errorCount > 0
				? appliedCount > 0
					? 'partially_applied'
					: 'error'
				: selectedActionCount === 0 || appliedCount > 0
					? 'applied'
					: 'partially_applied'

		const [updated] = await this.db
			.update(legacyMigrationQueue)
			.set({
				status: nextStatus,
				lastError:
					errorCount > 0
						? Object.values(applyResults)
								.filter((r) => r.status === 'error')
								.map((r) => r.message ?? 'apply error')
								.join('; ')
						: null,
				lastReviewedAt: new Date(),
				updatedAt: new Date(),
			})
			.where(eq(legacyMigrationQueue.id, id))
			.returning()

		await this.db.insert(legacyMigrationActions).values({
			queueId: id,
			action: 'apply',
			performedByUserId: null,
			payload: {
				...(payload ?? {}),
				applyResults,
				resultStatus: nextStatus,
			},
		})
		return { item: updated }
	}

	async dismissMigration(id: string, payload?: Record<string, unknown>) {
		const existing = await this.db.query.legacyMigrationQueue.findFirst({
			where: eq(legacyMigrationQueue.id, id),
		})
		if (!existing) return null
		const [updated] = await this.db
			.update(legacyMigrationQueue)
			.set({
				status: 'dismissed',
				lastReviewedAt: new Date(),
				updatedAt: new Date(),
			})
			.where(eq(legacyMigrationQueue.id, id))
			.returning()
		await this.db.insert(legacyMigrationActions).values({
			queueId: id,
			action: 'dismiss',
			payload: payload ?? {},
		})
		return { item: updated }
	}

	async resolveMigration(id: string, payload: { decision: 'accept' | 'reject' | 'needs_review'; note?: string }) {
		const existing = await this.db.query.legacyMigrationQueue.findFirst({
			where: eq(legacyMigrationQueue.id, id),
		})
		if (!existing) return null
		const conflicts =
			existing.conflicts && typeof existing.conflicts === 'object'
				? { ...existing.conflicts }
				: ({} as Record<string, unknown>)
		conflicts.resolution = {
			decision: payload.decision,
			note: payload.note ?? null,
			decidedByUserId: null,
			decidedAt: new Date().toISOString(),
		}
		const nextStatus: 'pending' | 'partially_applied' | 'applied' | 'dismissed' | 'error' =
			payload.decision === 'reject' ? 'dismissed' : payload.decision === 'accept' ? 'pending' : existing.status
		const [updated] = await this.db
			.update(legacyMigrationQueue)
			.set({
				status: nextStatus,
				conflicts,
				lastReviewedAt: new Date(),
				updatedAt: new Date(),
			})
			.where(eq(legacyMigrationQueue.id, id))
			.returning()
		await this.db.insert(legacyMigrationActions).values({
			queueId: id,
			action: 'update',
			payload: { type: 'resolve_conflict', ...payload },
		})
		return { item: updated }
	}

	async recheckUser(modernUserId: string, actorUserId?: string, options?: { force?: boolean }) {
		const force = options?.force === true
		const targetUser = await this.getCoreAdminUserDetails(modernUserId)
		if (!targetUser) {
			throw new Error('Target user not found')
		}
		const modernCharacterIds = [...new Set(targetUser.characters.map((c) => c.characterId))]
		if (modernCharacterIds.length === 0) {
			return { ok: true, modernUserId, created: 0, updated: 0, dismissed: 0, matches: [] }
		}
		const [legacyCharacterMatches, legacyDiscordMatches] = await Promise.all([
			this.db.query.legacyAuthCharacters.findMany({
				where: inArray(legacyAuthCharacters.characterId, modernCharacterIds),
				columns: { legacyAuthUserId: true, characterId: true, characterName: true, source: true },
			}),
			targetUser.discordUserId
				? this.db.query.legacyAuthDiscordAccounts.findMany({
						where: eq(legacyAuthDiscordAccounts.discordUserId, targetUser.discordUserId),
						columns: { legacyAuthUserId: true, discordUserId: true },
					})
				: Promise.resolve([]),
		])

		const legacyUserIds = [
			...new Set([
				...legacyCharacterMatches.map((m) => m.legacyAuthUserId),
				...legacyDiscordMatches.map((m) => m.legacyAuthUserId),
			]),
		]
		if (legacyUserIds.length === 0) {
			return { ok: true, modernUserId, created: 0, updated: 0, dismissed: 0, matches: [] }
		}
		const [
			ipCounts,
			noteCounts,
			applicationCounts,
			discordAccountCounts,
			existingRows,
			crossUserRows,
			allAssociatedCharacters,
			allAssociatedDiscordAccounts,
		] =
			await Promise.all([
				this.db
					.select({ legacyAuthUserId: legacyAuthUserIpAddresses.legacyAuthUserId, count: sql<number>`count(*)::int` })
					.from(legacyAuthUserIpAddresses)
					.where(inArray(legacyAuthUserIpAddresses.legacyAuthUserId, legacyUserIds))
					.groupBy(legacyAuthUserIpAddresses.legacyAuthUserId),
				this.db
					.select({ legacyAuthUserId: legacyAuthNotes.legacyAuthUserId, count: sql<number>`count(*)::int` })
					.from(legacyAuthNotes)
					.where(inArray(legacyAuthNotes.legacyAuthUserId, legacyUserIds))
					.groupBy(legacyAuthNotes.legacyAuthUserId),
				this.db
					.select({ legacyAuthUserId: legacyAuthApplications.legacyAuthUserId, count: sql<number>`count(*)::int` })
					.from(legacyAuthApplications)
					.where(inArray(legacyAuthApplications.legacyAuthUserId, legacyUserIds))
					.groupBy(legacyAuthApplications.legacyAuthUserId),
				this.db
					.select({
						legacyAuthUserId: legacyAuthDiscordAccounts.legacyAuthUserId,
						count: sql<number>`count(*)::int`,
					})
					.from(legacyAuthDiscordAccounts)
					.where(inArray(legacyAuthDiscordAccounts.legacyAuthUserId, legacyUserIds))
					.groupBy(legacyAuthDiscordAccounts.legacyAuthUserId),
				this.db.query.legacyMigrationQueue.findMany({
					where: and(
						eq(legacyMigrationQueue.modernUserId, modernUserId),
						inArray(legacyMigrationQueue.legacyAuthUserId, legacyUserIds)
					),
				}),
				this.db.query.legacyMigrationQueue.findMany({
					where: and(
						inArray(legacyMigrationQueue.legacyAuthUserId, legacyUserIds),
						ne(legacyMigrationQueue.modernUserId, modernUserId),
						notInArray(legacyMigrationQueue.status, ['dismissed'])
					),
					columns: { legacyAuthUserId: true, modernUserId: true, status: true },
				}),
				this.db.query.legacyAuthCharacters.findMany({
					where: inArray(legacyAuthCharacters.legacyAuthUserId, legacyUserIds),
					columns: { legacyAuthUserId: true, characterId: true, characterName: true },
				}),
				this.db.query.legacyAuthDiscordAccounts.findMany({
					where: inArray(legacyAuthDiscordAccounts.legacyAuthUserId, legacyUserIds),
					columns: { legacyAuthUserId: true, discordUserId: true },
				}),
			])
		const ipRows =
			legacyUserIds.length > 0
				? await this.db.query.legacyAuthUserIpAddresses.findMany({
						where: inArray(legacyAuthUserIpAddresses.legacyAuthUserId, legacyUserIds),
						columns: { legacyAuthUserId: true, ipAddress: true },
					})
				: []
		const uniqueMatchedIps = [...new Set(ipRows.map((row) => row.ipAddress).filter(Boolean))]
		const ipNeighborRows =
			uniqueMatchedIps.length > 0
				? await this.db.query.legacyAuthUserIpAddresses.findMany({
						where: and(
							inArray(legacyAuthUserIpAddresses.ipAddress, uniqueMatchedIps),
							notInArray(legacyAuthUserIpAddresses.legacyAuthUserId, legacyUserIds)
						),
						columns: { legacyAuthUserId: true, ipAddress: true },
					})
				: []
		const ipNeighborLegacyUserIds = [...new Set(ipNeighborRows.map((row) => row.legacyAuthUserId))]
		const [ipNeighborCharacters, ipNeighborDiscordAccounts] =
			ipNeighborLegacyUserIds.length > 0
				? await Promise.all([
						this.db.query.legacyAuthCharacters.findMany({
							where: inArray(legacyAuthCharacters.legacyAuthUserId, ipNeighborLegacyUserIds),
							columns: { legacyAuthUserId: true, characterId: true, characterName: true },
						}),
						this.db.query.legacyAuthDiscordAccounts.findMany({
							where: inArray(legacyAuthDiscordAccounts.legacyAuthUserId, ipNeighborLegacyUserIds),
							columns: { legacyAuthUserId: true, discordUserId: true },
						}),
					])
				: [[], []]
		const ipCountMap = new Map(ipCounts.map((r) => [r.legacyAuthUserId, r.count]))
		const noteCountMap = new Map(noteCounts.map((r) => [r.legacyAuthUserId, r.count]))
		const appCountMap = new Map(applicationCounts.map((r) => [r.legacyAuthUserId, r.count]))
		const discordCountMap = new Map(discordAccountCounts.map((r) => [r.legacyAuthUserId, r.count]))
		const existingMap = new Map(existingRows.map((row) => [row.legacyAuthUserId, row]))
		const crossUserMap = new Map<string, Array<{ modernUserId: string; status: string }>>()
		for (const row of crossUserRows) {
			const bucket = crossUserMap.get(row.legacyAuthUserId) ?? []
			bucket.push({ modernUserId: row.modernUserId, status: row.status })
			crossUserMap.set(row.legacyAuthUserId, bucket)
		}
		const matchByLegacyUser = new Map<string, typeof legacyCharacterMatches>()
		for (const row of legacyCharacterMatches) {
			const bucket = matchByLegacyUser.get(row.legacyAuthUserId) ?? []
			bucket.push(row)
			matchByLegacyUser.set(row.legacyAuthUserId, bucket)
		}
		const discordMatchesByLegacyUser = new Map<string, Array<{ discordUserId: string }>>()
		for (const row of legacyDiscordMatches) {
			const bucket = discordMatchesByLegacyUser.get(row.legacyAuthUserId) ?? []
			bucket.push({ discordUserId: row.discordUserId })
			discordMatchesByLegacyUser.set(row.legacyAuthUserId, bucket)
		}
		const allCharactersByLegacyUser = new Map<string, Array<{ characterId: string; characterName: string }>>()
		for (const row of allAssociatedCharacters) {
			const bucket = allCharactersByLegacyUser.get(row.legacyAuthUserId) ?? []
			bucket.push({ characterId: row.characterId, characterName: row.characterName })
			allCharactersByLegacyUser.set(row.legacyAuthUserId, bucket)
		}
		const allDiscordByLegacyUser = new Map<string, string[]>()
		for (const row of allAssociatedDiscordAccounts) {
			const bucket = allDiscordByLegacyUser.get(row.legacyAuthUserId) ?? []
			bucket.push(row.discordUserId)
			allDiscordByLegacyUser.set(row.legacyAuthUserId, bucket)
		}
		const ipAddressesByLegacyUser = new Map<string, string[]>()
		for (const row of ipRows) {
			const bucket = ipAddressesByLegacyUser.get(row.legacyAuthUserId) ?? []
			bucket.push(row.ipAddress)
			ipAddressesByLegacyUser.set(row.legacyAuthUserId, bucket)
		}
		const legacyUserIdsByIp = new Map<string, Set<string>>()
		for (const row of [...ipRows, ...ipNeighborRows]) {
			const bucket = legacyUserIdsByIp.get(row.ipAddress) ?? new Set<string>()
			bucket.add(row.legacyAuthUserId)
			legacyUserIdsByIp.set(row.ipAddress, bucket)
		}
		const SHARED_LEGACY_IP_USER_THRESHOLD = 10
		const sharedLegacyIpAddresses = new Set<string>()
		for (const [ipAddress, userIds] of legacyUserIdsByIp.entries()) {
			if (userIds.size > SHARED_LEGACY_IP_USER_THRESHOLD) {
				sharedLegacyIpAddresses.add(ipAddress)
			}
		}
		const neighborCharactersByLegacyUser = new Map<string, Array<{ characterId: string; characterName: string }>>()
		for (const row of ipNeighborCharacters) {
			const bucket = neighborCharactersByLegacyUser.get(row.legacyAuthUserId) ?? []
			bucket.push({ characterId: row.characterId, characterName: row.characterName })
			neighborCharactersByLegacyUser.set(row.legacyAuthUserId, bucket)
		}
		const neighborDiscordByLegacyUser = new Map<string, string[]>()
		for (const row of ipNeighborDiscordAccounts) {
			const bucket = neighborDiscordByLegacyUser.get(row.legacyAuthUserId) ?? []
			bucket.push(row.discordUserId)
			neighborDiscordByLegacyUser.set(row.legacyAuthUserId, bucket)
		}
		const coreStub = getStub<Core>(this.env.CORE, 'default')
		const now = new Date()
		let created = 0
		let updated = 0
		for (const legacyAuthUserId of legacyUserIds) {
			const matchingCharacters = matchByLegacyUser.get(legacyAuthUserId) ?? []
			const matchingDiscordAccounts = discordMatchesByLegacyUser.get(legacyAuthUserId) ?? []
			const matchingIpAddresses = ipAddressesByLegacyUser.get(legacyAuthUserId) ?? []
			const associatedCharacters = allCharactersByLegacyUser.get(legacyAuthUserId) ?? []
			const associatedDiscordUserIds = allDiscordByLegacyUser.get(legacyAuthUserId) ?? []
			const ipNeighborLegacyUsers = new Set<string>()
			for (const ipAddress of matchingIpAddresses) {
				if (sharedLegacyIpAddresses.has(ipAddress)) {
					continue
				}
				for (const legacyUserId of legacyUserIdsByIp.get(ipAddress) ?? new Set<string>()) {
					if (legacyUserId !== legacyAuthUserId) ipNeighborLegacyUsers.add(legacyUserId)
				}
			}
			const expandedCharacterPairs = [...associatedCharacters]
			const expandedDiscordIds = [...associatedDiscordUserIds]
			const sourceHints: Array<{
				targetType: 'character_id' | 'character_name' | 'discord_id'
				targetValue: string
				source: 'legacy_direct' | 'legacy_ip_association'
			}> = []
			for (const character of associatedCharacters) {
				sourceHints.push({ targetType: 'character_id', targetValue: character.characterId, source: 'legacy_direct' })
				sourceHints.push({ targetType: 'character_name', targetValue: character.characterName, source: 'legacy_direct' })
			}
			for (const discordUserId of associatedDiscordUserIds) {
				sourceHints.push({ targetType: 'discord_id', targetValue: discordUserId, source: 'legacy_direct' })
			}
			for (const neighborLegacyUserId of ipNeighborLegacyUsers) {
				for (const pair of neighborCharactersByLegacyUser.get(neighborLegacyUserId) ?? []) {
					expandedCharacterPairs.push(pair)
					sourceHints.push({ targetType: 'character_id', targetValue: pair.characterId, source: 'legacy_ip_association' })
					sourceHints.push({ targetType: 'character_name', targetValue: pair.characterName, source: 'legacy_ip_association' })
				}
				for (const discordUserId of neighborDiscordByLegacyUser.get(neighborLegacyUserId) ?? []) {
					expandedDiscordIds.push(discordUserId)
					sourceHints.push({ targetType: 'discord_id', targetValue: discordUserId, source: 'legacy_ip_association' })
				}
			}
			const crossUserMatches = crossUserMap.get(legacyAuthUserId) ?? []
			const blacklistSignals = await coreStub.evaluateLegacyMigrationBlacklistSignals({
				modernUserId,
				characterPairs: expandedCharacterPairs.map((character) => ({
					characterId: character.characterId,
					characterName: character.characterName,
				})),
				discordUserIds: expandedDiscordIds,
				ipAddresses: matchingIpAddresses,
				sourceHints,
			})
			const candidateSnapshot = {
				modernUserId,
				modernCharacterIds,
				matchingCharacters,
				matchingDiscordAccounts,
				matchingIpAddresses,
				matchSources: {
					characterLink: matchingCharacters.length > 0,
					discordId: matchingDiscordAccounts.length > 0,
					ipAddress: matchingIpAddresses.length > 0,
				},
				associatedCounts: {
					characters: matchingCharacters.length,
					ipAddresses: ipCountMap.get(legacyAuthUserId) ?? 0,
					notes: noteCountMap.get(legacyAuthUserId) ?? 0,
					applications: appCountMap.get(legacyAuthUserId) ?? 0,
					discordAccounts: discordCountMap.get(legacyAuthUserId) ?? 0,
				},
				recheckedAt: now.toISOString(),
				recheckMode: force ? 'force' : 'standard',
				recheckVersion: 2,
			} satisfies Record<string, unknown>
			const conflicts = {
				multipleLegacyUsersForModernUser: legacyUserIds.length > 1,
				crossModernUserQueueMatches: crossUserMatches,
				matchSource: matchingDiscordAccounts.length > 0 ? 'discord_id' : 'character_link',
				blacklistSignals,
			} satisfies Record<string, unknown>
			const existing = existingMap.get(legacyAuthUserId)
			let queueId = existing?.id
			if (existing) {
				const shouldReopenDismissed =
					existing.status === 'dismissed' &&
					this.hasMaterialNewFindings({
						existingSnapshot: existing.candidateSnapshot,
						existingConflicts: existing.conflicts,
						nextSnapshot: candidateSnapshot,
						nextConflicts: conflicts,
					})
				await this.db
					.update(legacyMigrationQueue)
					.set({
						status: force ? 'pending' : shouldReopenDismissed ? 'pending' : existing.status,
						candidateSnapshot,
						conflicts,
						lastMatchedAt: now,
						lastError: null,
						updatedAt: now,
					})
					.where(eq(legacyMigrationQueue.id, existing.id))
				updated += 1
			} else {
				const [inserted] = await this.db
					.insert(legacyMigrationQueue)
					.values({
						modernUserId,
						legacyAuthUserId,
						status: 'pending',
						candidateSnapshot,
						conflicts,
						lastMatchedAt: now,
						updatedAt: now,
					})
					.returning({ id: legacyMigrationQueue.id })
				queueId = inserted?.id
				created += 1
			}
			if (queueId) {
				await this.db.insert(legacyMigrationActions).values({
					queueId,
					action: existing ? 'update' : 'create',
					performedByUserId: actorUserId ?? null,
					payload: { trigger: 'manual_recheck' },
				})
				await this.db.insert(legacyMigrationActions).values({
					queueId,
					action: 'recheck',
					performedByUserId: actorUserId ?? null,
					payload: { trigger: 'manual_recheck' },
				})
			}
		}
		return { ok: true, modernUserId, legacyAuthUserIds: legacyUserIds, created, updated, dismissed: 0 }
	}

	async listHistory(filters: {
		page: number
		pageSize: number
		corporationId?: string
		characterIds?: string
		characterName?: string
		corporationName?: string
	}) {
		const where = []
		if (filters.corporationId) where.push(eq(legacyAuthApplications.corporationId, filters.corporationId))
		if (filters.characterIds) {
			const ids = filters.characterIds
				.split(',')
				.map((value) => value.trim())
				.filter(Boolean)
			if (ids.length > 0) where.push(inArray(legacyAuthApplications.characterId, ids))
		}
		if (filters.characterName) {
			where.push(ilike(legacyAuthApplications.characterName, `%${filters.characterName}%`))
		}
		if (filters.corporationName) {
			where.push(ilike(legacyAuthApplications.corporationName, `%${filters.corporationName}%`))
		}
		const whereClause = where.length > 0 ? and(...where) : undefined
		const offset = (filters.page - 1) * filters.pageSize
		const [rows, totalRows] = await Promise.all([
			this.db.query.legacyAuthApplications.findMany({
				where: whereClause,
				orderBy: [desc(legacyAuthApplications.applicationDate), desc(legacyAuthApplications.createdAt)],
				limit: filters.pageSize,
				offset,
			}),
			this.db
				.select({ count: sql<number>`count(*)::int` })
				.from(legacyAuthApplications)
				.where(whereClause ?? sql`true`),
		])
		const total = totalRows[0]?.count ?? 0
		return {
			items: rows,
			pagination: {
				page: filters.page,
				pageSize: filters.pageSize,
				total,
				totalPages: Math.max(1, Math.ceil(total / filters.pageSize)),
			},
		}
	}

	async getHistoryApplication(legacyApplicationId: string) {
		const application = await this.db.query.legacyAuthApplications.findFirst({
			where: eq(legacyAuthApplications.legacyApplicationId, legacyApplicationId),
		})
		if (!application) return null
		const events = await this.db.query.legacyAuthApplicationEvents.findMany({
			where: eq(legacyAuthApplicationEvents.legacyApplicationId, legacyApplicationId),
			orderBy: [asc(legacyAuthApplicationEvents.eventAt), asc(legacyAuthApplicationEvents.createdAt)],
		})
		const actorLegacyIds = [
			...new Set(
				events
					.map((event) => event.legacyActorUserId)
					.filter((id): id is string => Boolean(id))
			),
		]
		const actorLegacyCharacterNames = await this.resolveLegacyActorCharacterNames(actorLegacyIds)
		return { application, events, actorLegacyCharacterNames }
	}
}
