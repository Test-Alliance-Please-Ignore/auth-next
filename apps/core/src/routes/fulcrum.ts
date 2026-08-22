import { eq } from 'drizzle-orm'
import { Hono } from 'hono'

import { getStub, withRpcResult } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'
import { isOpenApplicationStatus } from '@repo/hr'

import { managedCorporations, userCharacters, users } from '../db/schema'
import { waitUntilWithTelemetry } from '../lib/background-task'
import { getCachedUserPermissions } from '../lib/groups-cache'
import { queueImmunitasAccessAlertForUser } from '../lib/immunitas-alerts'
import { requireAllianceMember, requireAuth } from '../middleware/session'

import type { Context } from 'hono'
import type { Core } from '@repo/core'
import type { EveCharacterData } from '@repo/eve-character-data'
import type { EveCorporationData } from '@repo/eve-corporation-data'
import type { Fulcrum, ReportRequestSource, ReportSectionName } from '@repo/fulcrum'
import type { Hr } from '@repo/hr'
import type { App, SessionUser } from '../context'

const app = new Hono<App>()
app.use('*', requireAuth(), requireAllianceMember())
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

async function getReportAccessSnapshot(
	fulcrum: Fulcrum,
	reportId: string
): Promise<{ status: string; requestorCorporationId: string } | null> {
	return withRpcResult(fulcrum.getReportStatus(reportId), (report) =>
		report
			? {
					status: report.status,
					requestorCorporationId: report.requestorCorporationId,
				}
			: null
	)
}

function getExecutionContextOrNull(c: Context<App>): Pick<ExecutionContext, 'waitUntil'> | null {
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

async function getCharacterCorporationId(
	c: Context<App>,
	characterId: string
): Promise<string | null> {
	const characterStub = getStub<EveCharacterData>(c.env.EVE_CHARACTER_DATA, 'default')
	return withRpcResult(characterStub.getInstance(characterId), (characterInstance) =>
		withRpcResult(characterInstance.getCharacterInfo(), (characterInfo) =>
			characterInfo?.corporationId ? String(characterInfo.corporationId) : null
		)
	)
}

type FulcrumCorporationResolution = {
	corporationId: string | null
	sawPermission: boolean
	sawOpenApplication: boolean
}

async function resolveApplicationFulcrumCorporationForTargetUser(
	hr: Hr,
	requestor: SessionUser,
	targetUserId: string
): Promise<FulcrumCorporationResolution> {
	const applications = await withRpcResult(
		hr.listApplications({ userId: targetUserId }, requestor.id, {
			isAdmin: false,
			isAuditor: false,
		}),
		(result) => result.map((application) => ({ ...application }))
	)

	let sawPermission = false
	let sawOpenApplication = false
	for (const application of applications) {
		const hasPermission = await hr.checkPermission(
			requestor.id,
			application.corporationId,
			'hr_reviewer'
		)
		if (!hasPermission) {
			continue
		}
		sawPermission = true
		if (isOpenApplicationStatus(application.status)) {
			sawOpenApplication = true
			return {
				corporationId: application.corporationId,
				sawPermission,
				sawOpenApplication,
			}
		}
	}

	return {
		corporationId: null,
		sawPermission,
		sawOpenApplication,
	}
}

type FulcrumSharedCorporationResolution = {
	corporationId: string | null
	sawPermission: boolean
}

type FulcrumReportAccessResolution = {
	corporationId: string | null
	error: 'open_application_required' | 'unauthorized' | null
}

type FulcrumCharacterReportRow = {
	characterId: string
	reports: Awaited<ReturnType<Fulcrum['listReports']>>
	role: 'CEO' | 'Director' | 'Member' | null
	activityStatus: 'active' | 'inactive' | 'unknown' | null
}

async function resolveSharedFulcrumCorporationForTargetUser(
	c: Context<App>,
	hr: Hr,
	requestor: SessionUser,
	targetUserId: string
): Promise<FulcrumSharedCorporationResolution> {
	const core = getCoreStub(c)
	const corporations = await withRpcResult(core.getUserCorporations(targetUserId), (result) =>
		result.map((corporation) => ({ ...corporation }))
	)
	if (corporations.length === 0) {
		return {
			corporationId: null,
			sawPermission: false,
		}
	}

	for (const corporation of corporations) {
		const hasPermission = await hr.checkPermission(
			requestor.id,
			corporation.corporationId,
			'hr_reviewer'
		)
		if (hasPermission) {
			return {
				corporationId: corporation.corporationId,
				sawPermission: true,
			}
		}
	}

	return {
		corporationId: null,
		sawPermission: false,
	}
}

async function resolveFulcrumReportAccessForTargetUser(
	c: Context<App>,
	hr: Hr,
	requestor: SessionUser,
	targetUserId: string
): Promise<FulcrumReportAccessResolution> {
	const applicationResolution = await resolveApplicationFulcrumCorporationForTargetUser(
		hr,
		requestor,
		targetUserId
	)
	if (applicationResolution.corporationId) {
		return {
			corporationId: applicationResolution.corporationId,
			error: null,
		}
	}

	const sharedResolution = await resolveSharedFulcrumCorporationForTargetUser(
		c,
		hr,
		requestor,
		targetUserId
	)
	if (sharedResolution.corporationId) {
		return {
			corporationId: sharedResolution.corporationId,
			error: null,
		}
	}

	if (applicationResolution.sawPermission) {
		return {
			corporationId: null,
			error: 'open_application_required',
		}
	}

	return {
		corporationId: null,
		error: 'unauthorized',
	}
}

async function buildFulcrumCharacterReportRows(
	c: Context<App>,
	userId: string,
	characters: Array<{
		characterId: string
		corporationId?: string | null
	}>
): Promise<FulcrumCharacterReportRow[]> {
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
					withRpcResult(corpStub.getCorporationInfo(corpId), (result) =>
						result ? { ceoId: result.ceoId } : null
					),
					withRpcResult(corpStub.getDirectors(corpId), (result) =>
						result.map((director) => ({ characterId: director.characterId }))
					),
					withRpcResult(corpStub.getMemberTracking(corpId), (result) =>
						result.map((tracking) => ({
							characterId: tracking.characterId,
							logonDate: tracking.logonDate,
						}))
					),
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

	const fulcrum = getFulcrumStub(c)
	return await Promise.all(
		characters.map(async (char) => {
			let reports: Awaited<ReturnType<Fulcrum['listReports']>> = []
			try {
				reports = await withRpcResult(
					fulcrum.listReports({ characterId: char.characterId }, 50),
					(result) => result.map((report) => ({ ...report }))
				)
			} catch (error) {
				logger.warn('[Fulcrum] Failed to list reports for character while building user data', {
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
						new Date().getTime() - lastLogon.getTime() < activeThresholdMs ? 'active' : 'inactive'
				}
			}

			return {
				characterId: char.characterId,
				reports,
				role,
				activityStatus,
			}
		})
	)
}

async function resolveFallbackFulcrumCorporationId(
	c: Context<App>,
	hr: Hr,
	requestor: SessionUser,
	targetUserId: string,
	characterId: string
): Promise<string | null> {
	const applications = await withRpcResult(
		hr.listApplications({ userId: targetUserId }, requestor.id, {
			isAdmin: requestor.is_admin,
			isAuditor: await isHrAuditorUser(c, requestor),
		}),
		(result) => result.map((application) => ({ ...application }))
	)
	const applicationCorporationId = applications[0]?.corporationId ?? null
	if (applicationCorporationId) {
		return applicationCorporationId
	}

	return await getCharacterCorporationId(c, characterId)
}

async function isMemberCorpCeo(c: Context<App>, characterId: string): Promise<boolean> {
	const db = c.get('db')
	if (!db) {
		throw new Error('Database not available')
	}

	const characterStub = getStub<EveCharacterData>(c.env.EVE_CHARACTER_DATA, 'default')
	const characterInfo = await withRpcResult(
		characterStub.getInstance(characterId),
		(characterInstance) =>
			withRpcResult(characterInstance.getCharacterInfo(), (result) =>
				result ? { corporationId: result.corporationId } : null
			)
	)
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
	const corpInfo = await withRpcResult(corpStub.getCorporationInfo(corporationId), (result) =>
		result ? { ceoId: result.ceoId } : null
	)
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

		// Auditors bypass corp-scoped checks. For regular HR staff, derive the
		// allowed corporation from backend state so the caller does not need to
		// supply a scoping query parameter.
		if (!auditor) {
			const hr = getHrStub(c)
			const accessResolution = await resolveFulcrumReportAccessForTargetUser(c, hr, user, userId)
			if (!accessResolution.corporationId) {
				return c.json(
					{ error: 'HR staff access requires a shared corporation or an open application' },
					403
				)
			}
		} else if (corporationId) {
			// Keep the old query parameter accepted for auditor-driven callers, but
			// do not rely on it for authorization decisions.
		}

		const core = getCoreStub(c)
		const characters = await withRpcResult(core.getUserCharacters(userId, false), (result) =>
			result.map((character) => ({ ...character }))
		)
		const reportRows = await buildFulcrumCharacterReportRows(c, userId, characters)
		const results = reportRows.map((row, index) => {
			const char = characters[index]
			return {
				characterId: char.characterId,
				characterName: char.characterName,
				corporationId: char.corporationId ?? null,
				corporationName: char.corporationName ?? null,
				allianceId: char.allianceId ?? null,
				allianceName: char.allianceName ?? null,
				hasValidToken: char.hasValidToken,
				role: row.role,
				activityStatus: row.activityStatus,
				reports: row.reports,
			}
		})

		return c.json(results)
	} catch (error) {
		logger.error('[Fulcrum] Failed to list user characters with reports', {
			userId,
			error: error instanceof Error ? error.message : String(error),
		})
		return c.json(
			{ error: error instanceof Error ? error.message : 'Failed to list characters' },
			500
		)
	}
})

/**
 * GET /api/fulcrum/users/:userId/reports
 * List report metadata for all linked characters on a user.
 */
app.get('/users/:userId/reports', requireAuth(), async (c) => {
	const user = c.get('user')!
	const userId = c.req.param('userId')
	const corporationId = c.req.query('corporationId')

	try {
		const auditor = await isHrAuditorUser(c, user)

		if (!auditor) {
			const hr = getHrStub(c)
			const accessResolution = await resolveFulcrumReportAccessForTargetUser(c, hr, user, userId)
			if (!accessResolution.corporationId) {
				return c.json(
					{ error: 'HR staff access requires a shared corporation or an open application' },
					403
				)
			}
		} else if (corporationId) {
			// Keep the old query parameter accepted for auditor-driven callers, but
			// do not rely on it for authorization decisions.
		}

		const core = getCoreStub(c)
		const characters = await withRpcResult(core.getUserCharacters(userId, false), (result) =>
			result.map((character) => ({ ...character }))
		)
		const reportRows = await buildFulcrumCharacterReportRows(c, userId, characters)

		return c.json(reportRows)
	} catch (error) {
		logger.error('[Fulcrum] Failed to list user character reports', {
			userId,
			error: error instanceof Error ? error.message : String(error),
		})
		return c.json(
			{ error: error instanceof Error ? error.message : 'Failed to list character reports' },
			500
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

	try {
		const db = c.get('db')
		if (!db) {
			return c.json({ error: 'Database not available' }, 500)
		}

		const auditor = await isHrAuditorUser(c, user)

		if (!auditor) {
			const hr = getHrStub(c)
			const target = await getImmunitasReportTarget(c, db, characterId)
			if (!target) {
				return c.json({ error: 'Fulcrum reports are not allowed for this character' }, 403)
			}
			const accessResolution = await resolveFulcrumReportAccessForTargetUser(
				c,
				hr,
				user,
				target.userId
			)
			if (accessResolution.corporationId) {
				// Access is established by the backend user/corp resolution.
			} else if (accessResolution.error === 'open_application_required') {
				return c.json(
					{ error: 'An open application is required to view Fulcrum reports for this user' },
					403
				)
			} else {
				return c.json(
					{ error: 'HR staff access requires a shared corporation or an open application' },
					403
				)
			}
		}

		if (auditor) {
			// Auditors bypass HR scope checks.
		}

		const fulcrum = getFulcrumStub(c)
		const reports = await withRpcResult(fulcrum.listReports({ characterId }, 50), (result) =>
			result.map((report) => ({ ...report }))
		)

		return c.json(reports)
	} catch (error) {
		logger.error('[Fulcrum] Failed to list character reports', {
			characterId,
			error: error instanceof Error ? error.message : String(error),
		})
		return c.json({ error: error instanceof Error ? error.message : 'Failed to list reports' }, 500)
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

		const auditor = await isHrAuditorUser(c, user)
		const immunitasTarget = await getImmunitasReportTarget(c, db, characterId)
		const resolvedTargetUserId = immunitasTarget?.userId
		if (!resolvedTargetUserId) {
			return c.json({ error: 'Fulcrum report requests are not allowed for this character' }, 403)
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
				waitUntilWithTelemetry(executionCtx, 'fulcrum.immunitas-report-alert', queueTask, {
					userId: user.id,
					characterId,
					targetUserId: immunitasTarget.userId,
					accessType: 'fulcrum-report',
				})
			} else {
				await queueTask()
			}
			return c.json({ error: 'Fulcrum report requests are not allowed for this character' }, 403)
		}

		const hr = getHrStub(c)
		if (isSelfImmunitasTarget) {
			const resolvedCorporationId = await resolveFallbackFulcrumCorporationId(
				c,
				hr,
				user,
				resolvedTargetUserId,
				characterId
			)
			if (!resolvedCorporationId) {
				return c.json({ error: 'Fulcrum report requests are not allowed for this character' }, 403)
			}

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

		if (!auditor && !user.is_admin && (await isMemberCorpCeo(c, characterId))) {
			return c.json(
				{ error: 'Only auditors or site admins can request reports for member corp CEOs' },
				403
			)
		}

		let resolvedCorporationId: string | null = null
		if (auditor || user.is_admin) {
			resolvedCorporationId = await resolveFallbackFulcrumCorporationId(
				c,
				hr,
				user,
				resolvedTargetUserId,
				characterId
			)
			if (!resolvedCorporationId) {
				return c.json({ error: 'Fulcrum report requests are not allowed for this character' }, 403)
			}
		} else {
			const accessResolution = await resolveFulcrumReportAccessForTargetUser(
				c,
				hr,
				user,
				resolvedTargetUserId
			)
			if (accessResolution.corporationId) {
				resolvedCorporationId = accessResolution.corporationId
			} else if (accessResolution.error === 'open_application_required') {
				return c.json(
					{ error: 'An open application is required to request Fulcrum reports for this user' },
					403
				)
			} else {
				return c.json({ error: 'Fulcrum report requests are not allowed for this character' }, 403)
			}
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
			500
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
				403
			)
		}
		const resolvedTargetUserIds = [...new Set(resolvedTargets.map((target) => target.userId))]
		if (resolvedTargetUserIds.length > 1) {
			return c.json(
				{ error: 'Batch report requests must target characters owned by the same user' },
				400
			)
		}
		const resolvedTargetUserId = resolvedTargetUserIds[0] ?? null
		const blockedImmunitasTargets = new Map(
			[...immunitasTargets.entries()].filter(([targetUserId]) => targetUserId !== user.id)
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
				waitUntilWithTelemetry(executionCtx, 'fulcrum.immunitas-report-batch-alert', queueTask, {
					userId: user.id,
					characterCount: body.characterIds.length,
					targetUserIds: [...blockedImmunitasTargets.keys()],
					accessType: 'fulcrum-report',
				})
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
		const hr = getHrStub(c)

		if (isSelfImmunitasBatch) {
			const resolvedCorporationId = await resolveFallbackFulcrumCorporationId(
				c,
				hr,
				user,
				resolvedTargetUserId!,
				body.characterIds[0]!
			)
			if (!resolvedCorporationId) {
				return c.json(
					{ error: 'Fulcrum report requests are not allowed for these characters' },
					403
				)
			}
			const fulcrum = getFulcrumStub(c)
			const result = await withRpcResult(
				fulcrum.createBulkCharacterReports({
					characterIds: body.characterIds,
					requestorUserId: user.id,
					requestorCorporationId: resolvedCorporationId,
					requestSource: body.requestSource,
					applicationId: body.applicationId,
					targetUserId: resolvedTargetUserId,
					sendDm: body.sendDm ?? true,
				}),
				(value) => ({ ...value })
			)

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

		let resolvedCorporationId: string | null = null
		if (auditor || user.is_admin) {
			resolvedCorporationId = await resolveFallbackFulcrumCorporationId(
				c,
				hr,
				user,
				resolvedTargetUserId!,
				body.characterIds[0]!
			)
			if (!resolvedCorporationId) {
				return c.json(
					{ error: 'Fulcrum report requests are not allowed for these characters' },
					403
				)
			}
		} else {
			for (const targetCharacterId of body.characterIds) {
				if (!auditor && !user.is_admin && (await isMemberCorpCeo(c, targetCharacterId))) {
					return c.json(
						{ error: 'Only auditors or site admins can request reports for member corp CEOs' },
						403
					)
				}
			}

			const accessResolution = await resolveFulcrumReportAccessForTargetUser(
				c,
				hr,
				user,
				resolvedTargetUserId!
			)
			if (accessResolution.corporationId) {
				resolvedCorporationId = accessResolution.corporationId
			} else if (accessResolution.error === 'open_application_required') {
				return c.json(
					{ error: 'An open application is required to request Fulcrum reports for this user' },
					403
				)
			} else {
				return c.json(
					{ error: 'Fulcrum report requests are not allowed for these characters' },
					403
				)
			}
		}

		const fulcrum = getFulcrumStub(c)
		const result = await withRpcResult(
			fulcrum.createBulkCharacterReports({
				characterIds: body.characterIds,
				requestorUserId: user.id,
				requestorCorporationId: resolvedCorporationId,
				requestSource: body.requestSource,
				applicationId: body.applicationId,
				sendDm: body.sendDm ?? true,
				targetUserId: resolvedTargetUserId ?? user.id,
			}),
			(value) => ({ ...value })
		)

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
			500
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
		const report = await getReportAccessSnapshot(fulcrum, reportId)

		if (!report) {
			return c.json({ error: 'Report not found' }, 404)
		}

		if (!(await isHrAuditorUser(c, user))) {
			const hr = getHrStub(c)
			const hasPermission = await hr.checkPermission(
				user.id,
				report.requestorCorporationId,
				'hr_viewer'
			)
			if (!hasPermission) {
				return c.json({ error: 'HR role required' }, 403)
			}
		}

		if (report.status !== 'completed') {
			return c.json({ error: 'Report not ready', status: report.status }, 400)
		}

		return withRpcResult(fulcrum.getReportSections(reportId), (manifest) => {
			if (!manifest) {
				return c.json({ error: 'Report manifest not found' }, 404)
			}
			return c.json(manifest)
		})
	} catch (error) {
		return c.json(
			{ error: error instanceof Error ? error.message : 'Failed to get report sections' },
			500
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
		const report = await getReportAccessSnapshot(fulcrum, reportId)

		if (!report) {
			return c.json({ error: 'Report not found' }, 404)
		}

		if (!(await isHrAuditorUser(c, user))) {
			const hr = getHrStub(c)
			const hasPermission = await hr.checkPermission(
				user.id,
				report.requestorCorporationId,
				'hr_viewer'
			)
			if (!hasPermission) {
				return c.json({ error: 'HR role required' }, 403)
			}
		}

		if (report.status !== 'completed') {
			return c.json({ error: 'Report not ready', status: report.status }, 400)
		}

		const pageParam = c.req.query('page')
		const pageSizeParam = c.req.query('pageSize')
		let page: number | undefined
		let pageSize: number | undefined
		if (pageParam !== undefined) {
			page = Number(pageParam)
			if (!Number.isInteger(page) || page < 0) {
				return c.json({ error: 'Page must be a non-negative integer' }, 400)
			}
		}
		if (pageSizeParam !== undefined) {
			if (page === undefined) {
				return c.json({ error: 'page is required when pageSize is provided' }, 400)
			}
			pageSize = Number(pageSizeParam)
			if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 200) {
				return c.json({ error: 'pageSize must be an integer between 1 and 200' }, 400)
			}
		}

		if (page === undefined) {
			const manifest = await withRpcResult(fulcrum.getReportSections(reportId), (result) =>
				result ? { sections: { ...result.sections } } : null
			)
			if ((manifest?.sections[section]?.chunks ?? 0) > 0) {
				return c.json({ error: 'A page parameter is required for chunked report sections' }, 400)
			}
		}

		return withRpcResult(
			page === undefined && pageSize === undefined
				? fulcrum.getReportSectionData(reportId, section)
				: fulcrum.getReportSectionData(reportId, section, page, pageSize),
			(data) => (data ? c.json(data) : c.json({ error: 'Section data not found' }, 404))
		)
	} catch (error) {
		return c.json(
			{ error: error instanceof Error ? error.message : 'Failed to get section data' },
			500
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
		const report = await getReportAccessSnapshot(fulcrum, reportId)

		if (!report) {
			return c.json({ error: 'Report not found' }, 404)
		}

		if (!(await isHrAuditorUser(c, user))) {
			const hr = getHrStub(c)
			const hasPermission = await hr.checkPermission(
				user.id,
				report.requestorCorporationId,
				'hr_viewer'
			)
			if (!hasPermission) {
				return c.json({ error: 'HR role required' }, 403)
			}
		}

		if (report.status !== 'completed') {
			return c.json({ error: 'Report not ready', status: report.status }, 400)
		}

		const body = await fulcrum.fetchMailContent(reportId, mailId)
		if (!body) {
			return c.json({ error: 'Mail content not available' }, 404)
		}

		return c.json({ body })
	} catch (error) {
		return c.json(
			{ error: error instanceof Error ? error.message : 'Failed to fetch mail content' },
			500
		)
	}
})

export default app
