/**
 * Test HTTP routes for local development and testing
 * Provides HTTP wrappers around Fulcrum Durable Object RPC methods
 */

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { getStub } from '@repo/do-utils'

import type { Fulcrum } from '@repo/fulcrum'
import type { App } from './context'

const testRoutes = new Hono<App>()

// Validation schemas
const createReportSchema = z.object({
	characterId: z.string().min(1, 'characterId is required'),
	requestorUserId: z.string().min(1, 'requestorUserId is required'),
	requestorCorporationId: z.string().min(1, 'requestorCorporationId is required'),
	requestSource: z.string().min(1).default('hr'),
	applicationId: z.string().optional(),
})

const listReportsQuerySchema = z.object({
	corporationId: z.string().optional(),
	characterId: z.string().optional(),
	status: z.string().optional(),
	limit: z.coerce.number().int().positive().max(100).default(50),
	offset: z.coerce.number().int().nonnegative().default(0),
})

/**
 * POST /test/reports
 * Create a new character report
 *
 * Body:
 * {
 *   "characterId": "12345",
 *   "requestorUserId": "67890",
 *   "requestorCorporationId": "11111"
 * }
 *
 * Response:
 * {
 *   "reportId": "uuid-here",
 *   "status": "pending",
 *   "expiresAt": "2025-01-26T00:00:00.000Z"
 * }
 */
testRoutes.post('/reports', zValidator('json', createReportSchema), async (c) => {
	const { characterId, requestorUserId, requestorCorporationId, requestSource, applicationId } = c.req.valid('json')

	try {
		// Get the Fulcrum Durable Object stub
		const stub = getStub<Fulcrum>(c.env.FULCRUM, 'default')

		// Call the RPC method
		const reportId = await stub.createCharacterReport({
			characterId,
			requestorUserId,
			requestorCorporationId,
			requestSource: requestSource as 'hr',
			applicationId,
		})

		// Get the full report metadata
		const report = await stub.getReportStatus(reportId)

		if (!report) {
			return c.json({ error: 'Failed to retrieve created report' }, 500)
		}

		return c.json(
			{
				reportId,
				status: report.status,
				characterId: report.characterId,
				expiresAt: report.expiresAt,
				createdAt: report.createdAt,
			},
			201,
		)
	} catch (error) {
		return c.json(
			{
				error: 'Failed to create report',
				message: error instanceof Error ? error.message : String(error),
			},
			500,
		)
	}
})

/**
 * GET /test/reports/:reportId
 * Get report status and metadata
 *
 * Response:
 * {
 *   "id": "uuid",
 *   "characterId": "12345",
 *   "characterName": "Character Name",
 *   "status": "pending",
 *   "requestorUserId": "67890",
 *   "requestorCorporationId": "11111",
 *   "workflowInstanceId": "workflow-uuid",
 *   "createdAt": "...",
 *   "updatedAt": "...",
 *   "expiresAt": "...",
 *   "viewedAt": null,
 *   "errorMessage": null
 * }
 */
testRoutes.get('/reports/:reportId', async (c) => {
	const reportId = c.req.param('reportId')

	try {
		const stub = getStub<Fulcrum>(c.env.FULCRUM, 'default')
		const report = await stub.getReportStatus(reportId)

		if (!report) {
			return c.json({ error: 'Report not found' }, 404)
		}

		return c.json(report)
	} catch (error) {
		return c.json(
			{
				error: 'Failed to get report status',
				message: error instanceof Error ? error.message : String(error),
			},
			500,
		)
	}
})

/**
 * GET /test/reports/:reportId/html
 * Get report HTML content
 *
 * Response:
 * - HTML content (text/html)
 * - 404 if report not found or HTML not available
 * - 410 if report is expired
 */
testRoutes.get('/reports/:reportId/html', async (c) => {
	const reportId = c.req.param('reportId')

	try {
		const stub = getStub<Fulcrum>(c.env.FULCRUM, 'default')

		// First check report status
		const report = await stub.getReportStatus(reportId)

		if (!report) {
			return c.json({ error: 'Report not found' }, 404)
		}

		if (report.status === 'expired') {
			return c.json({ error: 'Report has expired' }, 410)
		}

		if (report.status !== 'completed') {
			return c.json(
				{
					error: 'Report not ready',
					status: report.status,
					message: `Report is currently ${report.status}`,
				},
				400,
			)
		}

		// Get the HTML content
		const html = await stub.getReportHtml(reportId)

		if (!html) {
			return c.json({ error: 'Report HTML not found' }, 404)
		}

		return c.html(html)
	} catch (error) {
		return c.json(
			{
				error: 'Failed to get report HTML',
				message: error instanceof Error ? error.message : String(error),
			},
			500,
		)
	}
})

/**
 * GET /test/reports
 * List reports with optional filtering
 *
 * Query params:
 * - corporationId: string (optional)
 * - characterId: string (optional)
 * - status: string (optional)
 * - limit: number (default: 50, max: 100)
 * - offset: number (default: 0)
 *
 * Response:
 * {
 *   "reports": [...],
 *   "count": 10,
 *   "limit": 50,
 *   "offset": 0
 * }
 */
testRoutes.get('/reports', zValidator('query', listReportsQuerySchema), async (c) => {
	const { corporationId, characterId, status, limit, offset } = c.req.valid('query')

	try {
		const stub = getStub<Fulcrum>(c.env.FULCRUM, 'default')

		const filters: { corporationId?: string; characterId?: string; status?: string } = {}
		if (corporationId) filters.corporationId = corporationId
		if (characterId) filters.characterId = characterId
		if (status) filters.status = status

		const reports = await stub.listReports(filters, limit, offset)

		return c.json({
			reports,
			count: reports.length,
			limit,
			offset,
		})
	} catch (error) {
		return c.json(
			{
				error: 'Failed to list reports',
				message: error instanceof Error ? error.message : String(error),
			},
			500,
		)
	}
})

/**
 * POST /test/reports/:reportId/cancel
 * Cancel a pending or processing report
 *
 * Response:
 * {
 *   "success": true,
 *   "cancelled": true
 * }
 */
testRoutes.post('/reports/:reportId/cancel', async (c) => {
	const reportId = c.req.param('reportId')

	try {
		const stub = getStub<Fulcrum>(c.env.FULCRUM, 'default')
		const cancelled = await stub.cancelReport(reportId)

		if (!cancelled) {
			// Get report status to provide better error message
			const report = await stub.getReportStatus(reportId)

			if (!report) {
				return c.json({ error: 'Report not found' }, 404)
			}

			return c.json(
				{
					error: 'Cannot cancel report',
					status: report.status,
					message: `Report is ${report.status} and cannot be cancelled`,
				},
				400,
			)
		}

		return c.json({
			success: true,
			cancelled: true,
		})
	} catch (error) {
		return c.json(
			{
				error: 'Failed to cancel report',
				message: error instanceof Error ? error.message : String(error),
			},
			500,
		)
	}
})

export default testRoutes
