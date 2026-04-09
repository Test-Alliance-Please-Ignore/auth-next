import { Hono } from 'hono'

import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

import { requireAuth } from '../middleware/session'

import type { Context } from 'hono'
import type { Core } from '@repo/core'
import type { Fulcrum, ReportRequestSource, ReportSectionName } from '@repo/fulcrum'
import type { Hr } from '@repo/hr'
import type { App } from '../context'

const app = new Hono<App>()

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
 * Valid section names for validation
 */
const VALID_SECTIONS: ReportSectionName[] = [
	'public-info',
	'assets',
	'fitted-ships',
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
		if (!corporationId) {
			return c.json({ error: 'corporationId query parameter is required' }, 400)
		}

		// Check HR permission
		const hr = getHrStub(c)
		const hasPermission = await hr.checkPermission(user.id, corporationId, 'hr_viewer')
		if (!hasPermission && !user.is_admin) {
			return c.json({ error: 'HR role required' }, 403)
		}

		// Get all linked characters from Core DO
		const core = getCoreStub(c)
		const characters = await core.getUserCharacters(userId, false)

		// For each character, fetch their Fulcrum reports
		const fulcrum = getFulcrumStub(c)
		const results = await Promise.all(
			characters.map(async (char) => {
				const reports = await fulcrum.listReports({ characterId: char.characterId }, 50)
				return {
					characterId: char.characterId,
					characterName: char.characterName,
					corporationId: char.corporationId ?? null,
					corporationName: char.corporationName ?? null,
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
		// Require corporationId for scoping permission checks
		if (!corporationId) {
			return c.json({ error: 'corporationId query parameter is required' }, 400)
		}

		// Check HR permission for the corporation
		const hr = getHrStub(c)
		const hasPermission = await hr.checkPermission(user.id, corporationId, 'hr_viewer')
		if (!hasPermission && !user.is_admin) {
			return c.json({ error: 'HR role required' }, 403)
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
	}>()

	if (!body.corporationId) {
		return c.json({ error: 'corporationId is required' }, 400)
	}

	if (!body.requestSource || !VALID_REQUEST_SOURCES.includes(body.requestSource)) {
		return c.json({ error: 'Valid requestSource is required' }, 400)
	}

	try {
		// Check HR admin permission for creating reports
		const hr = getHrStub(c)
		const hasPermission = await hr.checkPermission(user.id, body.corporationId, 'hr_reviewer')
		if (!hasPermission && !user.is_admin) {
			return c.json({ error: 'HR reviewer or admin role required' }, 403)
		}

		const fulcrum = getFulcrumStub(c)
		const reportId = await fulcrum.createCharacterReport({
			characterId,
			requestorUserId: user.id,
			requestorCorporationId: body.corporationId,
			requestSource: body.requestSource,
			applicationId: body.applicationId,
		})

		logger.info('[Fulcrum] Report requested', {
			reportId,
			characterId,
			requestSource: body.requestSource,
			applicationId: body.applicationId,
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

// ============================================================================
// Report Content Endpoints
// ============================================================================

/**
 * GET /api/fulcrum/reports/:reportId/html
 * Get the HTML content of a Fulcrum report
 * REQUIRES: HR viewer or higher role
 */
app.get('/reports/:reportId/html', requireAuth(), async (c) => {
	const user = c.get('user')!
	const reportId = c.req.param('reportId')

	try {
		const fulcrum = getFulcrumStub(c)
		const report = await fulcrum.getReportStatus(reportId)

		if (!report) {
			return c.json({ error: 'Report not found' }, 404)
		}

		if (report.status === 'expired') {
			return c.json({ error: 'Report has expired' }, 410)
		}

		if (report.status !== 'completed') {
			return c.json({ error: 'Report not ready', status: report.status }, 400)
		}

		// Check HR permission for the report's corporation
		const hr = getHrStub(c)
		const hasPermission = await hr.checkPermission(
			user.id,
			report.requestorCorporationId,
			'hr_viewer',
		)
		if (!hasPermission && !user.is_admin) {
			return c.json({ error: 'HR role required' }, 403)
		}

		const html = await fulcrum.getReportHtml(reportId)
		if (!html) {
			return c.json({ error: 'Report HTML not found' }, 404)
		}

		return c.html(html)
	} catch (error) {
		return c.json(
			{ error: error instanceof Error ? error.message : 'Failed to get report' },
			500,
		)
	}
})

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

		const hr = getHrStub(c)
		const hasPermission = await hr.checkPermission(
			user.id,
			report.requestorCorporationId,
			'hr_viewer',
		)
		if (!hasPermission && !user.is_admin) {
			return c.json({ error: 'HR role required' }, 403)
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

		const hr = getHrStub(c)
		const hasPermission = await hr.checkPermission(
			user.id,
			report.requestorCorporationId,
			'hr_viewer',
		)
		if (!hasPermission && !user.is_admin) {
			return c.json({ error: 'HR role required' }, 403)
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

		const hr = getHrStub(c)
		const hasPermission = await hr.checkPermission(
			user.id,
			report.requestorCorporationId,
			'hr_viewer',
		)
		if (!hasPermission && !user.is_admin) {
			return c.json({ error: 'HR role required' }, 403)
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
