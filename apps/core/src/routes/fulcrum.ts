import { Hono } from 'hono'

import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

import { getCachedUserPermissions } from '../lib/groups-cache'
import { requireAuth } from '../middleware/session'

import type { Context } from 'hono'
import type { Core } from '@repo/core'
import type { EveCorporationData } from '@repo/eve-corporation-data'
import type { Fulcrum, ReportRequestSource, ReportSectionName } from '@repo/fulcrum'
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
		corporationId: string
		requestSource: ReportRequestSource
		applicationId?: string
		targetUserId?: string
		sendDm?: boolean
	}>()

	if (!body.corporationId) {
		return c.json({ error: 'corporationId is required' }, 400)
	}

	if (!body.requestSource || !VALID_REQUEST_SOURCES.includes(body.requestSource)) {
		return c.json({ error: 'Valid requestSource is required' }, 400)
	}

	try {
		const auditor = await isHrAuditorUser(c, user)

		// Check HR permission for creating reports (auditors can request)
		if (!auditor) {
			const hr = getHrStub(c)
			const hasPermission = await hr.checkPermission(user.id, body.corporationId, 'hr_reviewer')
			if (!hasPermission) {
				return c.json({ error: 'HR reviewer or admin role required' }, 403)
			}
		}

		const fulcrum = getFulcrumStub(c)
		const reportId = await fulcrum.createCharacterReport({
			characterId,
			requestorUserId: user.id,
			requestorCorporationId: body.corporationId,
			requestSource: body.requestSource,
			applicationId: body.applicationId,
			targetUserId: body.targetUserId,
			sendDm: body.sendDm ?? true,
		})

		logger.info('[Fulcrum] Report requested', {
			reportId,
			characterId,
			requestSource: body.requestSource,
			applicationId: body.applicationId,
			targetUserId: body.targetUserId,
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
		corporationId: string
		requestSource: ReportRequestSource
		characterIds: string[]
		applicationId?: string
		sendDm?: boolean
		targetUserId?: string
	}>()

	if (!body.corporationId) {
		return c.json({ error: 'corporationId is required' }, 400)
	}

	if (!Array.isArray(body.characterIds) || body.characterIds.length === 0) {
		return c.json({ error: 'characterIds is required' }, 400)
	}

	if (!body.requestSource || !VALID_REQUEST_SOURCES.includes(body.requestSource)) {
		return c.json({ error: 'Valid requestSource is required' }, 400)
	}

	try {
		const auditor = await isHrAuditorUser(c, user)
		if (!auditor) {
			const hr = getHrStub(c)
			const hasPermission = await hr.checkPermission(user.id, body.corporationId, 'hr_reviewer')
			if (!hasPermission) {
				return c.json({ error: 'HR reviewer or admin role required' }, 403)
			}
		}

		const fulcrum = getFulcrumStub(c)
		const result = await fulcrum.createBulkCharacterReports({
			characterIds: body.characterIds,
			requestorUserId: user.id,
			requestorCorporationId: body.corporationId,
			requestSource: body.requestSource,
			applicationId: body.applicationId,
			sendDm: body.sendDm ?? true,
			targetUserId: body.targetUserId,
		})

		logger.info('[Fulcrum] Bulk report batch requested', {
			batchId: result.batchId,
			characterCount: body.characterIds.length,
			requestSource: body.requestSource,
			applicationId: body.applicationId,
			sendDm: body.sendDm ?? true,
			targetUserId: body.targetUserId,
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
