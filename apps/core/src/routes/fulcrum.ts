import { eq } from 'drizzle-orm'
import { Hono } from 'hono'

import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

import { managedCorporations, userCharacters, users } from '../db/schema'
import { waitUntilWithTelemetry } from '../lib/background-task'
import { queueImmunitasAccessAlertForUser } from '../lib/immunitas-alerts'
import { getCachedUserPermissions } from '../lib/groups-cache'
import { requireAuth } from '../middleware/session'

import type { Context } from 'hono'
import type { Core } from '@repo/core'
import type { EveCharacterData } from '@repo/eve-character-data'
import type { EveCorporationData } from '@repo/eve-corporation-data'
import type { Fulcrum, ReportRequestSource, ReportSectionName } from '@repo/fulcrum'
import { ACTIVE_APPLICATION_STATUSES } from '@repo/hr'
import type { Hr } from '@repo/hr'
import type { App } from '../context'
import type { SessionUser } from '../context'

const app = new Hono<App>()
const MS_PER_DAY = 86_400_000

// ============================================================================
// Helpers
// ============================================================================

function getFulcrumStub(c: Context<App>): Fulcrum {
	return getStub<Fulcrum>(c.env.FULCRUM, 'default')
}

function getHrStub(c: Context<App>): Hr {
	return getStub<Hr>(c.env.HR, 'default')
}

function getCoreStub(c: Context<App>): Core {
	return getStub<Core>(c.env.CORE, 'default')
}

function getExecutionContextOrNull(c: Context<App>): ExecutionContext | null {
	try {
		return c.executionCtx
	} catch {
		return null
	}
}

async function getImmunitasReportTarget(
	c: Context<App>,
	db: any,
	characterId: string
): Promise<{
	userId: string
	characterLabel: string
	immunitas: boolean
} | null> {
	const owner = await db.query.userCharacters.findFirst({
		where: eq(userCharacters.characterId, characterId),
		columns: {
			userId: true,
			characterName: true,
		},
	})
	if (!owner) {
		return null
	}

	const user = await db.query.users.findFirst({
		where: eq(users.id, owner.userId),
		columns: {
			immunitas: true,
		},
	})

	return {
		userId: owner.userId,
		characterLabel: owner.characterName,
		immunitas: user?.immunitas === true,
	}
}

type ReportCorporationCandidates = {
	requestorCorporations: Array<{ corporationId: string }>
	targetCorporations: Array<{ corporationId: string }>
	sharedCorporationIds: string[]
}

async function getReportCorporationCandidates(
	core: Core,
	requestorUserId: string,
	targetUserId: string
): Promise<ReportCorporationCandidates> {
	const [requestorCorporations, targetCorporations] = await Promise.all([
		core.getUserCorporations(requestorUserId),
		core.getUserCorporations(targetUserId),
	])
	const targetCorporationIds = new Set(targetCorporations.map((corporation) => corporation.corporationId))
	return {
		requestorCorporations,
		targetCorporations,
		sharedCorporationIds: requestorCorporations
			.map((corporation) => corporation.corporationId)
			.filter((corporationId) => targetCorporationIds.has(corporationId)),
	}
}

type FulcrumReportAccessRole = 'hr_admin' | 'hr_reviewer' | null

function resolveHighestFulcrumReportAccessRole(
	roles: Array<{ role: string; isActive: boolean }>
): FulcrumReportAccessRole {
	const activeRoles = roles.filter((role) => role.isActive)
	if (activeRoles.some((role) => role.role === 'hr_admin')) return 'hr_admin'
	if (activeRoles.some((role) => role.role === 'hr_reviewer')) return 'hr_reviewer'
	return null
}

async function hasOpenApplicationForTargetUser(
	hr: Hr,
	requestor: SessionUser,
	corporationId: string,
	targetUserId: string
): Promise<boolean> {
	for (const status of ACTIVE_APPLICATION_STATUSES) {
		const applications = await hr.listApplications(
			{
				corporationId,
				userId: targetUserId,
				status,
				limit: 1,
			},
			requestor.id,
			{
				isAdmin: requestor.is_admin,
				isAuditor: false,
			}
		)
		if (applications.length > 0) {
			return true
		}
	}

	return false
}

async function isMemberCorpCeo(c: Context<App>, characterId: string): Promise<boolean> {
	const db = c.get('db')
	if (!db) {
		throw new Error('Database not available')
	}

	const characterStub = getStub<EveCharacterData>(c.env.EVE_CHARACTER_DATA, characterId)
	const characterInstance = await characterStub.getInstance(characterId)
	const characterInfo = await characterInstance.getCharacterInfo()
	if (!characterInfo?.corporationId) {
		return false
	}

	const corporationId = String(characterInfo.corporationId)
	const managedCorp = await db.query.managedCorporations.findFirst({
		where: eq(managedCorporations.corporationId, corporationId),
		columns: { isMemberCorporation: true },
	})
	if (!managedCorp?.isMemberCorporation) {
		return false
	}

	const corpStub = getStub<EveCorporationData>(c.env.EVE_CORPORATION_DATA, corporationId)
	const corpInfo = await corpStub.getCorporationInfo(corporationId)
	return corpInfo?.ceoId === characterId
}

/**
 * Check if a user has the urn:hr:auditor group permission (or is a site admin).
 */
async function isHrAuditorUser(c: Context<App>, user: SessionUser): Promise<boolean> {
	if (user.is_admin) return true
	const permissions = await getCachedUserPermissions(c.env, user.id)
	return permissions.some((p) => p.urn === 'urn:hr:auditor')
}

/**
 * Valid section names for validation
 */
const VALID_SECTIONS: ReportSectionName[] = [
	'public-info',
	'assets',
	'fitted-ships',
	'orders',
	'wallet-transactions',
	'wallet-journal',
	'mails',
	'contacts',
	'corp-history',
	'skills',
	'contracts',
	'notifications',
	'clones',
	'alerts',
]

/**
 * Valid request sources
 */
const VALID_REQUEST_SOURCES: ReportRequestSource[] = ['hr']

// ============================================================================
// User Characters + Reports Endpoint
// ============================================================================

/**
 * GET /api/fulcrum/users/:userId/characters
 * List all linked characters for a user with their Fulcrum reports
 * REQUIRES: HR viewer or higher role for the specified corporation
 */
app.get('/users/:userId/characters', requireAuth(), async (c) => {
	const user = c.get('user')!
	const userId = c.req.param('userId')
	const corporationId = c.req.query('corporationId')

	try {
		const auditor = await isHrAuditorUser(c, user)

		if (!corporationId && !auditor) {
			return c.json({ error: 'corporationId query parameter is required' }, 400)
		}

		// Check HR permission (auditors bypass corp-scoped check)
		if (!auditor) {
			const hr = getHrStub(c)
			const hasPermission = await hr.checkPermission(user.id, corporationId!, 'hr_viewer')
			if (!hasPermission) {
				return c.json({ error: 'HR role required' }, 403)
			}
		}

		// Get all linked characters from Core DO
		const core = getCoreStub(c)
		const characters = await core.getUserCharacters(userId, false)
		const corporationSnapshotCache = new Map<
			string,
			Promise<{
				ceoId: string | null
				directorIds: Set<string>
				lastLogonByCharacterId: Map<string, Date | null>
			}>
		>()

		const getCorporationSnapshot = async (corpId: string) => {
			if (!corporationSnapshotCache.has(corpId)) {
				const snapshotPromise = (async () => {
					const corpStub = getStub<EveCorporationData>(c.env.EVE_CORPORATION_DATA, corpId)
					const [corpInfo, directors, memberTracking] = await Promise.all([
						corpStub.getCorporationInfo(corpId),
						corpStub.getDirectors(corpId),
						corpStub.getMemberTracking(corpId),
					])

					return {
						ceoId: corpInfo ? String(corpInfo.ceoId) : null,
						directorIds: new Set(directors.map((d) => d.characterId)),
						lastLogonByCharacterId: new Map(
							memberTracking.map((tracking) => [tracking.characterId, tracking.logonDate])
						),
					}
				})()
				corporationSnapshotCache.set(corpId, snapshotPromise)
			}
			return corporationSnapshotCache.get(corpId)!
		}

		// For each character, fetch their Fulcrum reports
		const fulcrum = getFulcrumStub(c)
		const results = await Promise.all(
			characters.map(async (char) => {
				let reports: Awaited<ReturnType<Fulcrum['listReports']>> = []
				try {
					reports = await fulcrum.listReports({ characterId: char.characterId }, 50)
				} catch (error) {
					logger.warn('[Fulcrum] Failed to list reports for character while building user list', {
						userId,
						characterId: char.characterId,
						error: error instanceof Error ? error.message : String(error),
					})
				}
				let role: 'CEO' | 'Director' | 'Member' | null = null
				let activityStatus: 'active' | 'inactive' | 'unknown' | null = null

				if (char.corporationId) {
					const snapshot = await getCorporationSnapshot(String(char.corporationId))
					if (snapshot.ceoId === char.characterId) {
						role = 'CEO'
					} else if (snapshot.directorIds.has(char.characterId)) {
						role = 'Director'
					} else {
						role = 'Member'
					}

					const lastLogon = snapshot.lastLogonByCharacterId.get(char.characterId)
					if (!lastLogon) {
						activityStatus = 'unknown'
					} else {
						const activeThresholdMs = 7 * MS_PER_DAY
						activityStatus =
							new Date().getTime() - lastLogon.getTime() < activeThresholdMs
								? 'active'
								: 'inactive'
					}
				}

				return {
					characterId: char.characterId,
					characterName: char.characterName,
					corporationId: char.corporationId ?? null,
					corporationName: char.corporationName ?? null,
					allianceId: char.allianceId ?? null,
					allianceName: char.allianceName ?? null,
					hasValidToken: char.hasValidToken,
					role,
					activityStatus,
					reports,
				}
			}),
		)

		return c.json(results)
	} catch (error) {
		logger.error('[Fulcrum] Failed to list user characters with reports', {
			userId,
			error: error instanceof Error ? error.message : String(error),
		})
		return c.json(
			{ error: error instanceof Error ? error.message : 'Failed to list characters' },
			500,
		)
	}
})

// ============================================================================
// Character Report Endpoints
// ============================================================================

/**
 * GET /api/fulcrum/characters/:characterId/reports
 * List all reports for a character
 * REQUIRES: HR viewer or higher role for the requestor's corporation
 */
app.get('/characters/:characterId/reports', requireAuth(), async (c) => {
	const user = c.get('user')!
	const characterId = c.req.param('characterId')
	const corporationId = c.req.query('corporationId')

	try {
		const auditor = await isHrAuditorUser(c, user)

		// Require corporationId for scoping permission checks unless auditor
		if (!corporationId && !auditor) {
			return c.json({ error: 'corporationId query parameter is required' }, 400)
		}

		// Check HR permission for the corporation (auditors bypass)
		if (!auditor && corporationId) {
			const hr = getHrStub(c)
			const hasPermission = await hr.checkPermission(user.id, corporationId, 'hr_viewer')
			if (!hasPermission) {
				return c.json({ error: 'HR role required' }, 403)
			}
		}

		const fulcrum = getFulcrumStub(c)
		const reports = await fulcrum.listReports({ characterId }, 50)

		return c.json(reports)
	} catch (error) {
		logger.error('[Fulcrum] Failed to list character reports', {
			characterId,
			error: error instanceof Error ? error.message : String(error),
		})
		return c.json(
			{ error: error instanceof Error ? error.message : 'Failed to list reports' },
			500,
		)
	}
})

/**
 * POST /api/fulcrum/characters/:characterId/reports
 * Request a new Fulcrum report for a character
 * REQUIRES: HR admin role for the specified corporation
 */
app.post('/characters/:characterId/reports', requireAuth(), async (c) => {
	const user = c.get('user')!
	const characterId = c.req.param('characterId')
	const body = await c.req.json<{
		requestSource: ReportRequestSource
		applicationId?: string
		sendDm?: boolean
	}>()

	if (!body.requestSource || !VALID_REQUEST_SOURCES.includes(body.requestSource)) {
		return c.json({ error: 'Valid requestSource is required' }, 400)
	}

	try {
		const db = c.get('db')
		if (!db) {
			return c.json({ error: 'Database not available' }, 500)
		}

		const core = getCoreStub(c)
		const auditor = await isHrAuditorUser(c, user)
		const immunitasTarget = await getImmunitasReportTarget(c, db, characterId)
		const resolvedTargetUserId = immunitasTarget?.userId
		if (!resolvedTargetUserId) {
			return c.json(
				{ error: 'Fulcrum report requests are not allowed for this character' },
				403,
			)
		}
		const isSelfImmunitasTarget = immunitasTarget?.immunitas && resolvedTargetUserId === user.id
		const requestorCharacterLabel =
			user.characters.find((char) => char.is_primary)?.characterName ??
			user.characters[0]?.characterName ??
			user.mainCharacterId
		if (immunitasTarget?.immunitas && !isSelfImmunitasTarget) {
			const executionCtx = getExecutionContextOrNull(c)
			const queueTask = async () => {
				const coreStub = getCoreStub(c)
				await queueImmunitasAccessAlertForUser(coreStub, {
					targetUserId: immunitasTarget.userId,
					targetCharacterLabel: immunitasTarget.characterLabel,
					requestorUserId: user.id,
					requestorCharacterLabel,
					accessType: 'fulcrum-report',
					source: 'fulcrum-report-request',
				})
			}
			if (executionCtx) {
				waitUntilWithTelemetry(
					executionCtx,
					'fulcrum.immunitas-report-alert',
					queueTask,
					{
						userId: user.id,
						characterId,
						targetUserId: immunitasTarget.userId,
						accessType: 'fulcrum-report',
					}
				)
			} else {
				await queueTask()
			}
			return c.json(
				{ error: 'Fulcrum report requests are not allowed for this character' },
				403
			)
		}

		const requireSharedCorporation = !auditor && !user.is_admin && !isSelfImmunitasTarget
		const hr = getHrStub(c)
		const corporationCandidates = await getReportCorporationCandidates(core, user.id, resolvedTargetUserId)
		let resolvedCorporationId: string | null = null
		if (requireSharedCorporation) {
			if (corporationCandidates.sharedCorporationIds.length === 0) {
				return c.json(
					{ error: 'Fulcrum report requests are not allowed for this character' },
					403,
				)
			}

			let hasReviewerAccess = false
			let sawReviewerWithoutOpenApplication = false
			for (const corporationId of corporationCandidates.sharedCorporationIds) {
				const hasPermission = await hr.checkPermission(user.id, corporationId, 'hr_reviewer')
				if (!hasPermission) {
					continue
				}
				hasReviewerAccess = true

				const roles = await hr.getUserRoles(user.id, corporationId)
				const highestRole = resolveHighestFulcrumReportAccessRole(roles)
				if (highestRole === 'hr_admin') {
					resolvedCorporationId = corporationId
					break
				}

				if (highestRole === 'hr_reviewer') {
					const hasOpenApplication = await hasOpenApplicationForTargetUser(
						hr,
						user,
						corporationId,
						resolvedTargetUserId,
					)
					if (hasOpenApplication) {
						resolvedCorporationId = corporationId
						break
					}
					sawReviewerWithoutOpenApplication = true
				}
			}

			if (!resolvedCorporationId) {
				const error = !hasReviewerAccess
					? 'HR reviewer or admin role required'
					: sawReviewerWithoutOpenApplication
						? 'An open application is required to request Fulcrum reports for this user'
						: 'HR reviewer or admin role required'
				return c.json({ error }, 403)
			}
		} else {
			resolvedCorporationId =
				corporationCandidates.sharedCorporationIds[0] ??
				corporationCandidates.requestorCorporations[0]?.corporationId ??
				corporationCandidates.targetCorporations[0]?.corporationId ??
				null
			if (!resolvedCorporationId) {
				return c.json(
					{ error: 'Fulcrum report requests are not allowed for this character' },
					403,
				)
			}
		}

		if (isSelfImmunitasTarget) {
			const fulcrum = getFulcrumStub(c)
			const reportId = await fulcrum.createCharacterReport({
				characterId,
				requestorUserId: user.id,
				requestorCorporationId: resolvedCorporationId,
				requestSource: body.requestSource,
				applicationId: body.applicationId,
				targetUserId: resolvedTargetUserId,
				sendDm: body.sendDm ?? true,
			})

			logger.info('[Fulcrum] Report requested', {
				reportId,
				characterId,
				requestSource: body.requestSource,
				applicationId: body.applicationId,
				sendDm: body.sendDm ?? true,
				requestedBy: user.id,
			})

			return c.json({ reportId, status: 'pending' }, 201)
		}

		// Check HR permission for creating reports (auditors/admins can request)
		if (!auditor && !user.is_admin && (await isMemberCorpCeo(c, characterId))) {
			return c.json(
				{ error: 'Only auditors or site admins can request reports for member corp CEOs' },
				403,
			)
		}

		const fulcrum = getFulcrumStub(c)
		if (!resolvedCorporationId) {
			return c.json({ error: 'Fulcrum report requests are not allowed for this character' }, 403)
		}
		const reportId = await fulcrum.createCharacterReport({
			characterId,
			requestorUserId: user.id,
			requestorCorporationId: resolvedCorporationId,
			requestSource: body.requestSource,
			applicationId: body.applicationId,
			targetUserId: resolvedTargetUserId,
			sendDm: body.sendDm ?? true,
		})

		logger.info('[Fulcrum] Report requested', {
			reportId,
			characterId,
			requestSource: body.requestSource,
			applicationId: body.applicationId,
			targetUserId: resolvedTargetUserId,
			sendDm: body.sendDm ?? true,
			requestedBy: user.id,
		})

		return c.json({ reportId, status: 'pending' }, 201)
	} catch (error) {
		logger.error('[Fulcrum] Failed to request report', {
			characterId,
			error: error instanceof Error ? error.message : String(error),
		})
		return c.json(
			{ error: error instanceof Error ? error.message : 'Failed to request report' },
			500,
		)
	}
})

/**
 * POST /api/fulcrum/reports/batch
 * Request a new batch of Fulcrum reports for multiple characters
 * REQUIRES: HR admin role for the specified corporation
 */
app.post('/reports/batch', requireAuth(), async (c) => {
	const user = c.get('user')!
	const body = await c.req.json<{
		requestSource: ReportRequestSource
		characterIds: string[]
		applicationId?: string
		sendDm?: boolean
	}>()

	if (!Array.isArray(body.characterIds) || body.characterIds.length === 0) {
		return c.json({ error: 'characterIds is required' }, 400)
	}

	if (!body.requestSource || !VALID_REQUEST_SOURCES.includes(body.requestSource)) {
		return c.json({ error: 'Valid requestSource is required' }, 400)
	}

	try {
		const db = c.get('db')
		if (!db) {
			return c.json({ error: 'Database not available' }, 500)
		}

		const core = getCoreStub(c)
		const auditor = await isHrAuditorUser(c, user)
		const requestorCharacterLabel =
			user.characters.find((char) => char.is_primary)?.characterName ??
			user.characters[0]?.characterName ??
			user.mainCharacterId
		const immunitasTargets = new Map<string, string[]>()
		let hasSelfImmunitasTarget = false
		const unresolvedTargetCharacterIds: string[] = []
		const resolvedTargets: Array<{
			characterId: string
			userId: string
			characterLabel: string
			immunitas: boolean
		}> = []
		for (const targetCharacterId of body.characterIds) {
			const target = await getImmunitasReportTarget(c, db, targetCharacterId)
			if (!target) {
				unresolvedTargetCharacterIds.push(targetCharacterId)
				continue
			}
			resolvedTargets.push({
				characterId: targetCharacterId,
				userId: target.userId,
				characterLabel: target.characterLabel,
				immunitas: target.immunitas,
			})
			if (!target.immunitas) {
				continue
			}
			if (target.userId === user.id) {
				hasSelfImmunitasTarget = true
				continue
			}
			const labels = immunitasTargets.get(target.userId) ?? []
			labels.push(target.characterLabel)
			immunitasTargets.set(target.userId, labels)
		}
		if (unresolvedTargetCharacterIds.length > 0) {
			return c.json(
				{ error: 'Fulcrum report requests are not allowed for one or more targeted characters' },
				403,
			)
		}
		const resolvedTargetUserIds = [...new Set(resolvedTargets.map((target) => target.userId))]
		if (resolvedTargetUserIds.length > 1) {
			return c.json(
				{ error: 'Batch report requests must target characters owned by the same user' },
				400,
			)
		}
		const resolvedTargetUserId = resolvedTargetUserIds[0] ?? null
		const blockedImmunitasTargets = new Map(
			[...immunitasTargets.entries()].filter(([targetUserId]) => targetUserId !== user.id),
		)
		if (blockedImmunitasTargets.size > 0) {
			const executionCtx = getExecutionContextOrNull(c)
			const queueTask = async () => {
				const coreStub = getCoreStub(c)
				for (const [targetUserId, targetLabels] of blockedImmunitasTargets) {
					for (const targetCharacterLabel of targetLabels) {
						await queueImmunitasAccessAlertForUser(coreStub, {
							targetUserId,
							targetCharacterLabel,
							requestorUserId: user.id,
							requestorCharacterLabel,
							accessType: 'fulcrum-report',
							source: 'fulcrum-report-batch-request',
						})
					}
				}
			}
			if (executionCtx) {
				waitUntilWithTelemetry(
					executionCtx,
					'fulcrum.immunitas-report-batch-alert',
					queueTask,
					{
						userId: user.id,
						characterCount: body.characterIds.length,
						targetUserIds: [...blockedImmunitasTargets.keys()],
						accessType: 'fulcrum-report',
					}
				)
			} else {
				await queueTask()
			}
			return c.json(
				{ error: 'Fulcrum report requests are not allowed for one or more targeted characters' },
				403
			)
		}
		const isSelfImmunitasBatch =
			hasSelfImmunitasTarget &&
			immunitasTargets.size === 0 &&
			resolvedTargets.every((target) => target.userId === user.id)
		const requireSharedCorporation = !auditor && !user.is_admin && !isSelfImmunitasBatch
		const hr = getHrStub(c)
		const corporationCandidates = resolvedTargetUserId
			? await getReportCorporationCandidates(core, user.id, resolvedTargetUserId)
			: {
					requestorCorporations: [],
					targetCorporations: [],
					sharedCorporationIds: [],
				}
		let resolvedCorporationId: string | null = null
		if (requireSharedCorporation) {
			if (corporationCandidates.sharedCorporationIds.length === 0) {
				return c.json(
					{ error: 'Fulcrum report requests are not allowed for these characters' },
					403,
				)
			}

			let hasReviewerAccess = false
			let sawReviewerWithoutOpenApplication = false
			for (const corporationId of corporationCandidates.sharedCorporationIds) {
				const hasPermission = await hr.checkPermission(user.id, corporationId, 'hr_reviewer')
				if (!hasPermission) {
					continue
				}
				hasReviewerAccess = true

				const roles = await hr.getUserRoles(user.id, corporationId)
				const highestRole = resolveHighestFulcrumReportAccessRole(roles)
				if (highestRole === 'hr_admin') {
					resolvedCorporationId = corporationId
					break
				}

				if (highestRole === 'hr_reviewer') {
					const hasOpenApplication = await hasOpenApplicationForTargetUser(
						hr,
						user,
						corporationId,
						resolvedTargetUserId!,
					)
					if (hasOpenApplication) {
						resolvedCorporationId = corporationId
						break
					}
					sawReviewerWithoutOpenApplication = true
				}
			}

			if (!resolvedCorporationId) {
				const error = !hasReviewerAccess
					? 'HR reviewer or admin role required'
					: sawReviewerWithoutOpenApplication
						? 'An open application is required to request Fulcrum reports for this user'
						: 'HR reviewer or admin role required'
				return c.json({ error }, 403)
			}
		} else {
			resolvedCorporationId =
				corporationCandidates.sharedCorporationIds[0] ??
				corporationCandidates.requestorCorporations[0]?.corporationId ??
				corporationCandidates.targetCorporations[0]?.corporationId ??
				null
			if (!resolvedCorporationId) {
				return c.json(
					{ error: 'Fulcrum report requests are not allowed for these characters' },
					403,
				)
			}
		}
		if (isSelfImmunitasBatch) {
			const fulcrum = getFulcrumStub(c)
			const result = await fulcrum.createBulkCharacterReports({
				characterIds: body.characterIds,
				requestorUserId: user.id,
				requestorCorporationId: resolvedCorporationId,
				requestSource: body.requestSource,
				applicationId: body.applicationId,
				targetUserId: resolvedTargetUserId,
				sendDm: body.sendDm ?? true,
			})

			logger.info('[Fulcrum] Bulk report batch requested', {
				batchId: result.batchId,
				characterCount: body.characterIds.length,
				requestSource: body.requestSource,
				sendDm: body.sendDm ?? true,
				targetUserId: resolvedTargetUserId,
				requestedBy: user.id,
			})

			return c.json(result, 201)
		}

		for (const targetCharacterId of body.characterIds) {
			if (!auditor && !user.is_admin && (await isMemberCorpCeo(c, targetCharacterId))) {
				return c.json(
					{ error: 'Only auditors or site admins can request reports for member corp CEOs' },
					403,
				)
			}
		}

		const fulcrum = getFulcrumStub(c)
		const result = await fulcrum.createBulkCharacterReports({
			characterIds: body.characterIds,
			requestorUserId: user.id,
			requestorCorporationId: resolvedCorporationId,
			requestSource: body.requestSource,
			applicationId: body.applicationId,
			sendDm: body.sendDm ?? true,
			targetUserId: resolvedTargetUserId ?? user.id,
		})

		logger.info('[Fulcrum] Bulk report batch requested', {
			batchId: result.batchId,
			characterCount: body.characterIds.length,
			requestSource: body.requestSource,
			applicationId: body.applicationId,
			sendDm: body.sendDm ?? true,
			targetUserId: resolvedTargetUserIds[0] ?? user.id,
			requestedBy: user.id,
		})

		return c.json({ batchId: result.batchId, status: 'pending' }, 201)
	} catch (error) {
		logger.error('[Fulcrum] Failed to request bulk report batch', {
			characterCount: body.characterIds.length,
			error: error instanceof Error ? error.message : String(error),
		})
		return c.json(
			{ error: error instanceof Error ? error.message : 'Failed to request bulk reports' },
			500,
		)
	}
})

// ============================================================================
// Report Content Endpoints
// ============================================================================

/**
 * GET /api/fulcrum/reports/:reportId/sections
 * Get the manifest of available sections for a report
 * REQUIRES: HR viewer or higher role
 */
app.get('/reports/:reportId/sections', requireAuth(), async (c) => {
	const user = c.get('user')!
	const reportId = c.req.param('reportId')

	try {
		const fulcrum = getFulcrumStub(c)
		const report = await fulcrum.getReportStatus(reportId)

		if (!report) {
			return c.json({ error: 'Report not found' }, 404)
		}

		if (report.status !== 'completed') {
			return c.json({ error: 'Report not ready', status: report.status }, 400)
		}

		if (!(await isHrAuditorUser(c, user))) {
			const hr = getHrStub(c)
			const hasPermission = await hr.checkPermission(
				user.id,
				report.requestorCorporationId,
				'hr_viewer',
			)
			if (!hasPermission) {
				return c.json({ error: 'HR role required' }, 403)
			}
		}

		const manifest = await fulcrum.getReportSections(reportId)
		if (!manifest) {
			return c.json({ error: 'Report manifest not found' }, 404)
		}

		return c.json(manifest)
	} catch (error) {
		return c.json(
			{ error: error instanceof Error ? error.message : 'Failed to get report sections' },
			500,
		)
	}
})

/**
 * GET /api/fulcrum/reports/:reportId/sections/:section
 * Get processed data for a specific report section
 * REQUIRES: HR viewer or higher role
 */
app.get('/reports/:reportId/sections/:section', requireAuth(), async (c) => {
	const user = c.get('user')!
	const reportId = c.req.param('reportId')
	const section = c.req.param('section') as ReportSectionName

	// Validate section name
	if (!VALID_SECTIONS.includes(section)) {
		return c.json({ error: 'Invalid section name' }, 400)
	}

	try {
		const fulcrum = getFulcrumStub(c)
		const report = await fulcrum.getReportStatus(reportId)

		if (!report) {
			return c.json({ error: 'Report not found' }, 404)
		}

		if (report.status !== 'completed') {
			return c.json({ error: 'Report not ready', status: report.status }, 400)
		}

		if (!(await isHrAuditorUser(c, user))) {
			const hr = getHrStub(c)
			const hasPermission = await hr.checkPermission(
				user.id,
				report.requestorCorporationId,
				'hr_viewer',
			)
			if (!hasPermission) {
				return c.json({ error: 'HR role required' }, 403)
			}
		}

		const data = await fulcrum.getReportSectionData(reportId, section)
		if (!data) {
			return c.json({ error: 'Section data not found' }, 404)
		}

		return c.json(data)
	} catch (error) {
		return c.json(
			{ error: error instanceof Error ? error.message : 'Failed to get section data' },
			500,
		)
	}
})

/**
 * GET /api/fulcrum/reports/:reportId/mails/:mailId/content
 * Fetch a single mail's content on-demand from ESI
 * REQUIRES: HR viewer or higher role
 */
app.get('/reports/:reportId/mails/:mailId/content', requireAuth(), async (c) => {
	const user = c.get('user')!
	const reportId = c.req.param('reportId')
	const mailId = c.req.param('mailId')

	try {
		const fulcrum = getFulcrumStub(c)
		const report = await fulcrum.getReportStatus(reportId)

		if (!report) {
			return c.json({ error: 'Report not found' }, 404)
		}

		if (report.status !== 'completed') {
			return c.json({ error: 'Report not ready', status: report.status }, 400)
		}

		if (!(await isHrAuditorUser(c, user))) {
			const hr = getHrStub(c)
			const hasPermission = await hr.checkPermission(
				user.id,
				report.requestorCorporationId,
				'hr_viewer',
			)
			if (!hasPermission) {
				return c.json({ error: 'HR role required' }, 403)
			}
		}

		const body = await fulcrum.fetchMailContent(reportId, mailId)
		if (!body) {
			return c.json({ error: 'Mail content not available' }, 404)
		}

		return c.json({ body })
	} catch (error) {
		return c.json(
			{ error: error instanceof Error ? error.message : 'Failed to fetch mail content' },
			500,
		)
	}
})

export default app
