import { DurableObject } from 'cloudflare:workers'

import { and, asc, desc, eq, ilike, inArray, ne, notInArray, or, sql } from '@repo/db-utils'
import { computeQueueSeverity } from './services/legacy-match'
import { createDb } from './db'
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
import type { Env } from './context'

export class LegacyDO extends DurableObject<Env> implements Legacy {
	private db = createDb(this.env.DATABASE_URL)

	async fetch(_request: Request): Promise<Response> {
		return new Response('Legacy Durable Object RPC endpoint', { status: 200 })
	}

	private async getCoreAdminUserDetails(targetUserId: string): Promise<{
		id: string
		characters: Array<{ characterId: string }>
	} | null> {
		const response = await this.env.CORE.fetch(
			`https://core.internal/api/admin/users/${encodeURIComponent(targetUserId)}`,
			{
				method: 'GET',
			}
		)
		if (response.status === 404) return null
		if (!response.ok) throw new Error(`Failed to fetch target user details (${response.status})`)
		return (await response.json()) as { id: string; characters: Array<{ characterId: string }> }
	}

	async listMigrations(filters: {
		page: number
		pageSize: number
		status?: 'pending' | 'partially_applied' | 'applied' | 'dismissed' | 'error'
		severity?: 'none' | 'high' | 'critical'
		modernUserId?: string
		legacyAuthUserId?: string
	}) {
		const where = []
		if (filters.status) where.push(eq(legacyMigrationQueue.status, filters.status))
		if (filters.severity) where.push(eq(legacyMigrationQueue.severity, filters.severity))
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
		return {
			items: rows as LegacyMigrationQueueItem[],
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
		return { item, actions }
	}

	async applyMigration(id: string, payload?: Record<string, unknown>) {
		const existing = await this.db.query.legacyMigrationQueue.findFirst({
			where: eq(legacyMigrationQueue.id, id),
		})
		if (!existing) return null

		const applyResults: Record<string, { status: 'applied' | 'skipped' | 'error'; message?: string }> = {}
		const applyBlacklistToUser = Boolean(payload?.applyBlacklistToUser)
		const importCharacterLinks = Boolean(payload?.importCharacterLinks)
		const importNotes = Boolean(payload?.importNotes)
		const importIpAssociations = Boolean(payload?.importIpAssociations)
		const markSkipped = Boolean(payload?.markSkipped)

		if (applyBlacklistToUser) {
			const response = await this.env.CORE.fetch('https://core.internal/api/admin/blacklist/user', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					userId: existing.modernUserId,
					reason:
						typeof payload?.blacklistReason === 'string'
							? payload.blacklistReason
							: `Legacy migration blacklist action for legacy user ${existing.legacyAuthUserId}`,
					metadata: {
						source: 'legacy_migration_apply',
						queueId: existing.id,
						legacyAuthUserId: existing.legacyAuthUserId,
						...(typeof payload?.blacklistMetadata === 'object' && payload.blacklistMetadata
							? payload.blacklistMetadata
							: {}),
					},
				}),
			})
			if (!response.ok) {
				applyResults.applyBlacklistToUser = {
					status: 'error',
					message: `Blacklist request failed (${response.status})`,
				}
			} else {
				applyResults.applyBlacklistToUser = { status: 'applied' }
			}
		} else {
			applyResults.applyBlacklistToUser = { status: 'skipped' }
		}

		if (importCharacterLinks) {
			const characters = await this.db.query.legacyAuthCharacters.findMany({
				where: eq(legacyAuthCharacters.legacyAuthUserId, existing.legacyAuthUserId),
				columns: { characterId: true, characterName: true, source: true },
			})
			const response = await this.env.CORE.fetch('https://core.internal/api/admin/legacy/import-character-links', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					modernUserId: existing.modernUserId,
					legacyAuthUserId: existing.legacyAuthUserId,
					characters,
				}),
			})
			applyResults.importCharacterLinks = response.ok
				? { status: 'applied' }
				: { status: 'error', message: `Character-link import failed (${response.status})` }
		} else {
			applyResults.importCharacterLinks = { status: 'skipped' }
		}

		if (importNotes) {
			const notes = await this.db.query.legacyAuthNotes.findMany({
				where: eq(legacyAuthNotes.legacyAuthUserId, existing.legacyAuthUserId),
			})
			const response = await this.env.CORE.fetch('https://core.internal/api/admin/legacy/import-notes', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					modernUserId: existing.modernUserId,
					legacyAuthUserId: existing.legacyAuthUserId,
					notes: notes.map((note) => ({
						legacyNoteId: note.legacyNoteId,
						note: note.note,
						legacyCreatedByUserId: note.legacyCreatedByUserId,
						legacyDateCreated: note.legacyDateCreated ? note.legacyDateCreated.toISOString() : null,
						metadata: note.metadata ?? {},
					})),
				}),
			})
			applyResults.importNotes = response.ok
				? { status: 'applied' }
				: { status: 'error', message: `Notes import failed (${response.status})` }
		} else {
			applyResults.importNotes = { status: 'skipped' }
		}

		if (importIpAssociations) {
			const ips = await this.db.query.legacyAuthUserIpAddresses.findMany({
				where: eq(legacyAuthUserIpAddresses.legacyAuthUserId, existing.legacyAuthUserId),
				columns: { ipAddress: true },
			})
			const response = await this.env.CORE.fetch('https://core.internal/api/admin/legacy/import-ip-associations', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					modernUserId: existing.modernUserId,
					legacyAuthUserId: existing.legacyAuthUserId,
					ipAddresses: ips.map((entry) => ({ ipAddress: entry.ipAddress })),
				}),
			})
			applyResults.importIpAssociations = response.ok
				? { status: 'applied' }
				: { status: 'error', message: `IP import failed (${response.status})` }
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

	async recheckUser(modernUserId: string, actorUserId?: string) {
		const targetUser = await this.getCoreAdminUserDetails(modernUserId)
		if (!targetUser) {
			throw new Error('Target user not found')
		}
		const modernCharacterIds = [...new Set(targetUser.characters.map((c) => c.characterId))]
		if (modernCharacterIds.length === 0) {
			return { ok: true, modernUserId, created: 0, updated: 0, dismissed: 0, matches: [] }
		}
		const legacyCharacterMatches = await this.db.query.legacyAuthCharacters.findMany({
			where: inArray(legacyAuthCharacters.characterId, modernCharacterIds),
			columns: { legacyAuthUserId: true, characterId: true, characterName: true, source: true },
		})
		const legacyUserIds = [...new Set(legacyCharacterMatches.map((m) => m.legacyAuthUserId))]
		if (legacyUserIds.length === 0) {
			return { ok: true, modernUserId, created: 0, updated: 0, dismissed: 0, matches: [] }
		}
		const [ipCounts, noteCounts, applicationCounts, discordAccountCounts, existingRows, crossUserRows] =
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
			])
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
		const now = new Date()
		let created = 0
		let updated = 0
		for (const legacyAuthUserId of legacyUserIds) {
			const matchingCharacters = matchByLegacyUser.get(legacyAuthUserId) ?? []
			const crossUserMatches = crossUserMap.get(legacyAuthUserId) ?? []
			const severity = computeQueueSeverity({
				crossModernUserQueueMatches: crossUserMatches.length,
				multipleLegacyMatchesForModernUser: legacyUserIds.length > 1,
			})
			const candidateSnapshot = {
				modernUserId,
				modernCharacterIds,
				matchingCharacters,
				associatedCounts: {
					characters: matchingCharacters.length,
					ipAddresses: ipCountMap.get(legacyAuthUserId) ?? 0,
					notes: noteCountMap.get(legacyAuthUserId) ?? 0,
					applications: appCountMap.get(legacyAuthUserId) ?? 0,
					discordAccounts: discordCountMap.get(legacyAuthUserId) ?? 0,
				},
				recheckedAt: now.toISOString(),
			} satisfies Record<string, unknown>
			const conflicts = {
				multipleLegacyUsersForModernUser: legacyUserIds.length > 1,
				crossModernUserQueueMatches: crossUserMatches,
			} satisfies Record<string, unknown>
			const existing = existingMap.get(legacyAuthUserId)
			let queueId = existing?.id
			if (existing) {
				await this.db
					.update(legacyMigrationQueue)
					.set({
						status: existing.status === 'dismissed' ? 'pending' : existing.status,
						severity,
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
						severity,
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
					payload: { trigger: 'manual_recheck', severity },
				})
				await this.db.insert(legacyMigrationActions).values({
					queueId,
					action: 'recheck',
					performedByUserId: actorUserId ?? null,
					payload: { trigger: 'manual_recheck', severity },
				})
			}
		}
		return { ok: true, modernUserId, legacyAuthUserIds: legacyUserIds, created, updated, dismissed: 0 }
	}

	async listHistory(filters: {
		page: number
		pageSize: number
		corporationId?: string
		characterId?: string
		characterIds?: string
		characterName?: string
	}) {
		const where = []
		if (filters.corporationId) where.push(eq(legacyAuthApplications.corporationId, filters.corporationId))
		if (filters.characterId) where.push(eq(legacyAuthApplications.characterId, filters.characterId))
		if (filters.characterIds) {
			const ids = filters.characterIds
				.split(',')
				.map((value) => value.trim())
				.filter(Boolean)
			if (ids.length > 0) where.push(inArray(legacyAuthApplications.characterId, ids))
		}
		if (filters.characterName) {
			where.push(
				or(
					ilike(legacyAuthApplications.characterName, `%${filters.characterName}%`),
					ilike(legacyAuthApplications.corporationName, `%${filters.characterName}%`)
				)
			)
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
		return { application, events }
	}
}
