import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

import { requireAuth } from '../../middleware/session'
import { canAuditTaxFeature, canReadTaxReports } from '../../middleware/tax-permissions'
import {
	parseBooleanQueryParam,
	parseDateQueryParam,
	parseIntegerQueryParam,
	parseRollupReportFiltersFromQuery,
	parseSortDirectionQueryParam,
	sanitizeTaxErrorDetails,
	TAX_BILL_STATUS_SORT_FIELDS,
	TAX_DISCREPANCY_SORT_FIELDS,
	TAX_ESS_REPORT_SORT_FIELDS,
	TAX_EXPORT_FORMATS,
	TAX_EXPORT_REPORT_TYPES,
	TAX_EXPORT_SCHEDULE_FREQUENCIES,
	TAX_MISSING_ESI_SORT_FIELDS,
	TAX_TOTAL_TAXES_SORT_FIELDS,
} from './shared'

import type { Hono } from 'hono'
import type { CorporationTax } from '@repo/corporation-tax'
import type { App } from '../../context'

function logTaxReportsRouteError(
	c: { req: { method: string; path: string; url: string } },
	message: string,
	error: unknown,
	context?: Record<string, unknown>
): void {
	const url = new URL(c.req.url)
	logger.error(message, {
		...sanitizeTaxErrorDetails(error),
		method: c.req.method,
		path: c.req.path,
		query: Object.fromEntries(url.searchParams.entries()),
		...context,
	})
}

function isRpcMethodMissingError(error: unknown): boolean {
	if (!(error instanceof Error)) {
		return false
	}
	return (
		error.message.includes('RPC receiver does not implement the method') ||
		error.message.includes('does not implement the method')
	)
}

function buildReportErrorResponse(
	c: {
		env: { ENVIRONMENT: string }
		json: (body: unknown, status?: 200 | 500 | 503) => Response
	},
	error: unknown,
	defaultMessage: string
): Response {
	if (isRpcMethodMissingError(error)) {
		return c.json(
			{
				error:
					'Tax service is temporarily unavailable due to a deploy version mismatch. Please retry shortly.',
			},
			503
		)
	}

	const isNonProd = c.env.ENVIRONMENT !== 'production'
	return c.json(
		{
			error: defaultMessage,
			...(isNonProd ? { detail: error instanceof Error ? error.message : String(error) } : {}),
		},
		500
	)
}

export function registerCorporationTaxReportsRoutes(app: Hono<App>): void {
	/**
	 * GET /corporation-tax/reports/summary
	 * Summary dashboard totals.
	 */
	app.get('/reports/summary', requireAuth(), async (c) => {
		const user = c.get('user')
		if (!user) {
			return c.json({ error: 'Unauthorized' }, 401)
		}

		const parsed = parseRollupReportFiltersFromQuery(c.req)
		if (parsed.error) {
			return c.json({ error: parsed.error }, 400)
		}

		const canRead = await canReadTaxReports(c.env, user, parsed.filters?.corporationId)
		if (!canRead) {
			return c.json({ error: 'Forbidden' }, 403)
		}

		try {
			const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
			const summary = await stub.getSummaryReport(parsed.filters)
			return c.json(summary)
		} catch (error) {
			logTaxReportsRouteError(c, 'Error fetching corporation tax summary report', error, {
				userId: user.id,
				corporationId: parsed.filters?.corporationId,
			})
			return buildReportErrorResponse(c, error, 'Failed to fetch summary report')
		}
	})

	/**
	 * GET /corporation-tax/reports/total-taxes
	 * Total taxes by corporation.
	 */
	app.get('/reports/total-taxes', requireAuth(), async (c) => {
		const user = c.get('user')
		if (!user) {
			return c.json({ error: 'Unauthorized' }, 401)
		}

		const parsed = parseRollupReportFiltersFromQuery(c.req, {
			allowedSortFields: TAX_TOTAL_TAXES_SORT_FIELDS,
		})
		if (parsed.error) {
			return c.json({ error: parsed.error }, 400)
		}

		const canRead = await canReadTaxReports(c.env, user, parsed.filters?.corporationId)
		if (!canRead) {
			return c.json({ error: 'Forbidden' }, 403)
		}

		try {
			const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
			const report = await stub.getTotalTaxesByCorporationReport(parsed.filters)
			return c.json(report)
		} catch (error) {
			logTaxReportsRouteError(c, 'Error fetching total taxes by corporation report', error, {
				userId: user.id,
				corporationId: parsed.filters?.corporationId,
			})
			return buildReportErrorResponse(c, error, 'Failed to fetch total taxes by corporation report')
		}
	})

	/**
	 * GET /corporation-tax/reports/top-income
	 * Top taxable income sources by ref_type.
	 */
	app.get('/reports/top-income', requireAuth(), async (c) => {
		const user = c.get('user')
		if (!user) {
			return c.json({ error: 'Unauthorized' }, 401)
		}

		const parsed = parseRollupReportFiltersFromQuery(c.req)
		if (parsed.error) {
			return c.json({ error: parsed.error }, 400)
		}

		const canRead = await canReadTaxReports(c.env, user, parsed.filters?.corporationId)
		if (!canRead) {
			return c.json({ error: 'Forbidden' }, 403)
		}

		try {
			const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
			const report = await stub.getTopIncomeSourcesReport(parsed.filters)
			return c.json(report)
		} catch (error) {
			logTaxReportsRouteError(c, 'Error fetching top income sources report', error, {
				userId: user.id,
				corporationId: parsed.filters?.corporationId,
			})
			return c.json({ error: 'Failed to fetch top income sources report' }, 500)
		}
	})

	app.get('/reports/taxable-ref-types', requireAuth(), async (c) => {
		const user = c.get('user')
		if (!user) {
			return c.json({ error: 'Unauthorized' }, 401)
		}

		const corporationId = c.req.query('corporationId')?.trim() || undefined
		if (!(await canReadTaxReports(c.env, user, corporationId))) {
			return c.json({ error: 'Forbidden' }, 403)
		}

		try {
			const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
			const refTypes = await stub.getTaxableIncomeRefTypes(corporationId)
			return c.json({ refTypes })
		} catch (error) {
			logTaxReportsRouteError(c, 'Error fetching taxable report income types', error, {
				userId: user.id,
				corporationId,
			})
			return c.json({ error: 'Failed to fetch taxable income types' }, 500)
		}
	})

	/**
	 * GET /corporation-tax/reports/top-income-monthly
	 * Taxable inflow grouped by income type and month.
	 */
	app.get('/reports/top-income-monthly', requireAuth(), async (c) => {
		const user = c.get('user')
		if (!user) {
			return c.json({ error: 'Unauthorized' }, 401)
		}

		const parsed = parseRollupReportFiltersFromQuery(c.req)
		if (parsed.error) {
			return c.json({ error: parsed.error }, 400)
		}

		const canRead = await canReadTaxReports(c.env, user, parsed.filters?.corporationId)
		if (!canRead) {
			return c.json({ error: 'Forbidden' }, 403)
		}

		try {
			const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
			const report = await stub.getTopIncomeSourcesMonthlyReport(parsed.filters)
			return c.json(report)
		} catch (error) {
			logTaxReportsRouteError(c, 'Error fetching monthly top income sources report', error, {
				userId: user.id,
				corporationId: parsed.filters?.corporationId,
			})
			return c.json({ error: 'Failed to fetch monthly top income sources report' }, 500)
		}
	})

	/**
	 * GET /corporation-tax/reports/ess
	 * ESS transfer report.
	 */
	app.get('/reports/ess', requireAuth(), async (c) => {
		const user = c.get('user')
		if (!user) {
			return c.json({ error: 'Unauthorized' }, 401)
		}

		const parsed = parseRollupReportFiltersFromQuery(c.req, {
			allowedSortFields: TAX_ESS_REPORT_SORT_FIELDS,
		})
		if (parsed.error) {
			return c.json({ error: parsed.error }, 400)
		}

		const canRead = await canReadTaxReports(c.env, user, parsed.filters?.corporationId)
		if (!canRead) {
			return c.json({ error: 'Forbidden' }, 403)
		}

		try {
			const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
			const report = await stub.getEssPayoutReport(parsed.filters)
			return c.json(report)
		} catch (error) {
			logTaxReportsRouteError(c, 'Error fetching ESS payout report', error, {
				userId: user.id,
				corporationId: parsed.filters?.corporationId,
			})
			return c.json({ error: 'Failed to fetch ESS payout report' }, 500)
		}
	})

	/**
	 * GET /corporation-tax/reports/compliance
	 * Compliance trend over time from daily rollups.
	 */
	app.get('/reports/compliance', requireAuth(), async (c) => {
		const user = c.get('user')
		if (!user) {
			return c.json({ error: 'Unauthorized' }, 401)
		}

		const parsed = parseRollupReportFiltersFromQuery(c.req, {
			allowedSortFields: ['rollupDate', 'taxDue', 'taxPaid', 'taxDelta', 'entryCount'],
			maxLimit: 3650,
		})
		if (parsed.error) {
			return c.json({ error: parsed.error }, 400)
		}

		const canRead = await canReadTaxReports(c.env, user, parsed.filters?.corporationId)
		if (!canRead) {
			return c.json({ error: 'Forbidden' }, 403)
		}

		try {
			const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
			const report = await stub.getComplianceOverTimeReportPage(parsed.filters)
			return c.json(report)
		} catch (error) {
			logTaxReportsRouteError(c, 'Error fetching tax compliance report', error, {
				userId: user.id,
				corporationId: parsed.filters?.corporationId,
			})
			return c.json({ error: 'Failed to fetch tax compliance report' }, 500)
		}
	})

	/**
	 * GET /corporation-tax/reports/discrepancies
	 * Discrepancy report with optional open-only filter.
	 */
	app.get('/reports/discrepancies', requireAuth(), async (c) => {
		const user = c.get('user')
		if (!user) {
			return c.json({ error: 'Unauthorized' }, 401)
		}

		const corporationId = c.req.query('corporationId') || undefined
		const fromDate = parseDateQueryParam(c.req.query('fromDate'))
		const toDate = parseDateQueryParam(c.req.query('toDate'))
		const onlyOpen = parseBooleanQueryParam(c.req.query('onlyOpen'))
		const limit = parseIntegerQueryParam(c.req.query('limit'))
		const offset = parseIntegerQueryParam(c.req.query('offset'))
		const sortBy = c.req.query('sortBy') || undefined
		const sortDirection = parseSortDirectionQueryParam(c.req.query('sortDir'))

		if (fromDate === null) {
			return c.json({ error: 'fromDate must be a valid ISO date string' }, 400)
		}
		if (toDate === null) {
			return c.json({ error: 'toDate must be a valid ISO date string' }, 400)
		}
		if (fromDate && toDate && fromDate > toDate) {
			return c.json({ error: 'fromDate must be before or equal to toDate' }, 400)
		}
		if ((c.req.query('onlyOpen') ?? '') !== '' && onlyOpen === undefined) {
			return c.json({ error: 'onlyOpen must be true/false' }, 400)
		}
		if (limit !== undefined && (limit < 1 || limit > 200)) {
			return c.json({ error: 'limit must be an integer between 1 and 200' }, 400)
		}
		if (offset !== undefined && offset < 0) {
			return c.json({ error: 'offset must be an integer >= 0' }, 400)
		}
		if (sortDirection === null) {
			return c.json({ error: "sortDir must be 'asc' or 'desc'" }, 400)
		}
		if (
			sortBy &&
			!TAX_DISCREPANCY_SORT_FIELDS.includes(sortBy as (typeof TAX_DISCREPANCY_SORT_FIELDS)[number])
		) {
			return c.json(
				{ error: `sortBy must be one of: ${TAX_DISCREPANCY_SORT_FIELDS.join(', ')}` },
				400
			)
		}

		const canRead = await canReadTaxReports(c.env, user, corporationId)
		if (!canRead) {
			return c.json({ error: 'Forbidden' }, 403)
		}

		try {
			const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
			const report = await stub.getTaxDiscrepancyReport({
				corporationId,
				fromDate: fromDate ?? undefined,
				toDate: toDate ?? undefined,
				onlyOpen,
				limit,
				offset,
				sortBy,
				sortDirection: sortDirection ?? undefined,
			})
			return c.json(report)
		} catch (error) {
			logTaxReportsRouteError(c, 'Error fetching tax discrepancy report', error, {
				userId: user.id,
				corporationId,
			})
			return c.json({ error: 'Failed to fetch tax discrepancy report' }, 500)
		}
	})

	/**
	 * GET /corporation-tax/reports/missing-esi-keys
	 * Corporations with missing ESI key/scope coverage.
	 */
	app.get('/reports/missing-esi-keys', requireAuth(), async (c) => {
		const user = c.get('user')
		if (!user) {
			return c.json({ error: 'Unauthorized' }, 401)
		}

		const limit = parseIntegerQueryParam(c.req.query('limit'))
		const offset = parseIntegerQueryParam(c.req.query('offset'))
		const sortBy = c.req.query('sortBy') || undefined
		const sortDirection = parseSortDirectionQueryParam(c.req.query('sortDir'))

		if (limit !== undefined && (limit < 1 || limit > 200)) {
			return c.json({ error: 'limit must be an integer between 1 and 200' }, 400)
		}
		if (offset !== undefined && offset < 0) {
			return c.json({ error: 'offset must be an integer >= 0' }, 400)
		}
		if (sortDirection === null) {
			return c.json({ error: "sortDir must be 'asc' or 'desc'" }, 400)
		}
		if (
			sortBy &&
			!TAX_MISSING_ESI_SORT_FIELDS.includes(sortBy as (typeof TAX_MISSING_ESI_SORT_FIELDS)[number])
		) {
			return c.json(
				{ error: `sortBy must be one of: ${TAX_MISSING_ESI_SORT_FIELDS.join(', ')}` },
				400
			)
		}

		const canRead = await canAuditTaxFeature(c.env, user)
		if (!canRead) {
			return c.json({ error: 'Forbidden' }, 403)
		}

		try {
			const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
			const report = await stub.getMissingEsiKeysReport({
				limit,
				offset,
				sortBy,
				sortDirection: sortDirection ?? undefined,
			})
			return c.json(report)
		} catch (error) {
			logTaxReportsRouteError(c, 'Error fetching missing ESI keys report', error, {
				userId: user.id,
			})
			return c.json({ error: 'Failed to fetch missing ESI keys report' }, 500)
		}
	})

	/**
	 * GET /corporation-tax/reports/bill-status
	 * Assessment-level bill status report.
	 */
	app.get('/reports/bill-status', requireAuth(), async (c) => {
		const user = c.get('user')
		if (!user) {
			return c.json({ error: 'Unauthorized' }, 401)
		}

		const parsed = parseRollupReportFiltersFromQuery(c.req, {
			allowedSortFields: TAX_BILL_STATUS_SORT_FIELDS,
		})
		if (parsed.error) {
			return c.json({ error: parsed.error }, 400)
		}

		const canRead = await canReadTaxReports(c.env, user, parsed.filters?.corporationId)
		if (!canRead) {
			return c.json({ error: 'Forbidden' }, 403)
		}

		try {
			const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
			const report = await stub.getBillStatusReport(parsed.filters)
			return c.json(report)
		} catch (error) {
			logTaxReportsRouteError(c, 'Error fetching corporation tax bill status report', error, {
				userId: user.id,
				corporationId: parsed.filters?.corporationId,
			})
			return c.json({ error: 'Failed to fetch bill status report' }, 500)
		}
	})

	/**
	 * POST /corporation-tax/exports
	 * Request export generation for a tax report.
	 */
	app.post('/exports', requireAuth(), async (c) => {
		const user = c.get('user')
		if (!user) {
			return c.json({ error: 'Unauthorized' }, 401)
		}

		let body: Record<string, unknown>
		try {
			body = await c.req.json()
		} catch {
			return c.json({ error: 'Invalid JSON payload' }, 400)
		}

		const corporationId = typeof body.corporationId === 'string' ? body.corporationId : undefined
		const format = typeof body.format === 'string' ? body.format : ''
		const reportType = typeof body.reportType === 'string' ? body.reportType : ''
		const sourceEsiVersion =
			typeof body.sourceEsiVersion === 'string' || body.sourceEsiVersion === null
				? body.sourceEsiVersion
				: body.sourceEsiVersion === undefined
					? undefined
					: '__invalid__'
		const filters =
			typeof body.filters === 'object' && !Array.isArray(body.filters) && body.filters !== null
				? (body.filters as Record<string, unknown>)
				: body.filters === null || body.filters === undefined
					? null
					: undefined

		if (!TAX_EXPORT_FORMATS.has(format)) {
			return c.json({ error: "format must be 'csv' or 'xlsx'" }, 400)
		}
		if (!TAX_EXPORT_REPORT_TYPES.has(reportType)) {
			return c.json(
				{
					error:
						'reportType must be one of summary, total_taxes_by_corporation, top_income_sources, ess_payout, compliance_over_time, discrepancies, bill_status',
				},
				400
			)
		}
		if (filters === undefined) {
			return c.json({ error: 'filters must be an object or null' }, 400)
		}
		if (sourceEsiVersion === '__invalid__') {
			return c.json({ error: 'sourceEsiVersion must be a string or null' }, 400)
		}

		const canExport = await canReadTaxReports(c.env, user, corporationId)
		if (!canExport) {
			return c.json({ error: 'Forbidden' }, 403)
		}

		try {
			const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
			const created = await stub.requestExport(user.id, {
				corporationId,
				format: format as 'csv' | 'xlsx',
				reportType: reportType as
					| 'summary'
					| 'total_taxes_by_corporation'
					| 'top_income_sources'
					| 'ess_payout'
					| 'compliance_over_time'
					| 'discrepancies'
					| 'bill_status',
				filters,
				sourceEsiVersion,
			})
			return c.json(created, 201)
		} catch (error) {
			logTaxReportsRouteError(c, 'Error requesting corporation tax export', error, {
				userId: user.id,
				corporationId,
				reportType,
			})
			return c.json({ error: 'Failed to request export' }, 500)
		}
	})

	/**
	 * GET /corporation-tax/exports
	 * List tax export history.
	 */
	app.get('/exports', requireAuth(), async (c) => {
		const user = c.get('user')
		if (!user) {
			return c.json({ error: 'Unauthorized' }, 401)
		}

		const corporationId = c.req.query('corporationId') || undefined
		const format = c.req.query('format')
		const status = c.req.query('status')
		const limit = parseIntegerQueryParam(c.req.query('limit'))
		const offset = parseIntegerQueryParam(c.req.query('offset'))
		const sortBy = c.req.query('sortBy')
		const sortDir = parseSortDirectionQueryParam(c.req.query('sortDir'))

		if (format !== undefined && !TAX_EXPORT_FORMATS.has(format)) {
			return c.json({ error: "format must be 'csv' or 'xlsx'" }, 400)
		}
		if (
			status !== undefined &&
			status !== 'queued' &&
			status !== 'running' &&
			status !== 'completed' &&
			status !== 'failed'
		) {
			return c.json(
				{ error: "status must be one of 'queued', 'running', 'completed', or 'failed'" },
				400
			)
		}
		if (limit !== undefined && (limit < 1 || limit > 200)) {
			return c.json({ error: 'limit must be an integer between 1 and 200' }, 400)
		}
		if (offset !== undefined && offset < 0) {
			return c.json({ error: 'offset must be an integer >= 0' }, 400)
		}
		if (sortDir === null) {
			return c.json({ error: "sortDir must be 'asc' or 'desc'" }, 400)
		}
		const exportSortFields = [
			'requestedAt',
			'corporationId',
			'reportType',
			'format',
			'status',
			'rowCount',
			'completedAt',
		] as const
		if (sortBy && !exportSortFields.includes(sortBy as (typeof exportSortFields)[number])) {
			return c.json({ error: `sortBy must be one of: ${exportSortFields.join(', ')}` }, 400)
		}

		const canRead = await canReadTaxReports(c.env, user, corporationId)
		if (!canRead) {
			return c.json({ error: 'Forbidden' }, 403)
		}

		try {
			const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
			const exportsList = await stub.listExports({
				corporationId,
				format: format as 'csv' | 'xlsx' | undefined,
				status: status as 'queued' | 'running' | 'completed' | 'failed' | undefined,
				limit,
				offset,
				sortBy: sortBy as (typeof exportSortFields)[number] | undefined,
				sortDir: sortDir ?? undefined,
			})
			return c.json(exportsList)
		} catch (error) {
			logTaxReportsRouteError(c, 'Error listing corporation tax exports', error, {
				userId: user.id,
				corporationId,
			})
			return c.json({ error: 'Failed to list exports' }, 500)
		}
	})

	/**
	 * GET /corporation-tax/exports/:exportId/artifact
	 * Retrieve export artifact payload for client-side download.
	 */
	app.get('/exports/:exportId/artifact', requireAuth(), async (c) => {
		const user = c.get('user')
		if (!user) {
			return c.json({ error: 'Unauthorized' }, 401)
		}

		const exportId = c.req.param('exportId')
		if (!exportId) {
			return c.json({ error: 'exportId is required' }, 400)
		}

		try {
			const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
			const record = await stub.getExportById(exportId)
			if (!record) {
				return c.json({ error: 'Export not found' }, 404)
			}

			const canRead = await canReadTaxReports(c.env, user, record.corporationId ?? undefined)
			if (!canRead) {
				return c.json({ error: 'Forbidden' }, 403)
			}

			const artifact = await stub.getExportArtifact(exportId)
			return c.json(artifact)
		} catch (error) {
			if (error instanceof Error && error.message.includes('Export not found')) {
				return c.json({ error: 'Export not found' }, 404)
			}
			logTaxReportsRouteError(c, 'Error fetching tax export artifact', error, {
				userId: user.id,
				exportId,
			})
			return c.json({ error: 'Failed to fetch export artifact' }, 500)
		}
	})

	/**
	 * POST /corporation-tax/export-schedules
	 * Create an automated export schedule.
	 */
	app.post('/export-schedules', requireAuth(), async (c) => {
		const user = c.get('user')
		if (!user) {
			return c.json({ error: 'Unauthorized' }, 401)
		}

		let body: Record<string, unknown>
		try {
			body = await c.req.json()
		} catch {
			return c.json({ error: 'Invalid JSON payload' }, 400)
		}

		const name = typeof body.name === 'string' ? body.name.trim() : ''
		const corporationId = typeof body.corporationId === 'string' ? body.corporationId : undefined
		const format = typeof body.format === 'string' ? body.format : ''
		const frequency = typeof body.frequency === 'string' ? body.frequency : ''
		const reportType = typeof body.reportType === 'string' ? body.reportType : ''
		const filters =
			typeof body.filters === 'object' && !Array.isArray(body.filters) && body.filters !== null
				? (body.filters as Record<string, unknown>)
				: body.filters === null || body.filters === undefined
					? null
					: undefined
		const isActive = typeof body.isActive === 'boolean' ? body.isActive : undefined
		const nextRunAtRaw = typeof body.nextRunAt === 'string' ? new Date(body.nextRunAt) : undefined
		const nextRunAt =
			nextRunAtRaw && !Number.isNaN(nextRunAtRaw.getTime()) ? nextRunAtRaw : undefined

		if (!name) {
			return c.json({ error: 'name is required' }, 400)
		}
		if (!TAX_EXPORT_FORMATS.has(format)) {
			return c.json({ error: "format must be 'csv' or 'xlsx'" }, 400)
		}
		if (!TAX_EXPORT_SCHEDULE_FREQUENCIES.has(frequency)) {
			return c.json({ error: "frequency must be 'weekly' or 'monthly'" }, 400)
		}
		if (!TAX_EXPORT_REPORT_TYPES.has(reportType)) {
			return c.json(
				{
					error:
						'reportType must be one of summary, total_taxes_by_corporation, top_income_sources, ess_payout, compliance_over_time, discrepancies, bill_status',
				},
				400
			)
		}
		if (filters === undefined) {
			return c.json({ error: 'filters must be an object or null' }, 400)
		}
		if (typeof body.nextRunAt === 'string' && !nextRunAt) {
			return c.json({ error: 'nextRunAt must be a valid ISO date string' }, 400)
		}

		const canAudit = await canAuditTaxFeature(c.env, user, corporationId)
		if (!canAudit) {
			return c.json({ error: 'Forbidden' }, 403)
		}

		try {
			const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
			const schedule = await stub.createExportSchedule(user.id, {
				name,
				corporationId,
				format: format as 'csv' | 'xlsx',
				frequency: frequency as 'weekly' | 'monthly',
				reportType: reportType as
					| 'summary'
					| 'total_taxes_by_corporation'
					| 'top_income_sources'
					| 'ess_payout'
					| 'compliance_over_time'
					| 'discrepancies'
					| 'bill_status',
				filters,
				nextRunAt,
				isActive,
			})
			return c.json(schedule, 201)
		} catch (error) {
			logTaxReportsRouteError(c, 'Error creating corporation tax export schedule', error, {
				userId: user.id,
				corporationId,
				reportType,
			})
			return c.json({ error: 'Failed to create export schedule' }, 500)
		}
	})

	/**
	 * GET /corporation-tax/export-schedules
	 * List automated export schedules.
	 */
	app.get('/export-schedules', requireAuth(), async (c) => {
		const user = c.get('user')
		if (!user) {
			return c.json({ error: 'Unauthorized' }, 401)
		}

		const corporationId = c.req.query('corporationId') || undefined
		const activeOnly = parseBooleanQueryParam(c.req.query('activeOnly'))
		const limit = parseIntegerQueryParam(c.req.query('limit'))
		const offset = parseIntegerQueryParam(c.req.query('offset'))
		const sortBy = c.req.query('sortBy')
		const sortDir = parseSortDirectionQueryParam(c.req.query('sortDir'))

		if ((c.req.query('activeOnly') ?? '') !== '' && activeOnly === undefined) {
			return c.json({ error: 'activeOnly must be true/false' }, 400)
		}
		if (limit !== undefined && (limit < 1 || limit > 200)) {
			return c.json({ error: 'limit must be an integer between 1 and 200' }, 400)
		}
		if (offset !== undefined && offset < 0) {
			return c.json({ error: 'offset must be an integer >= 0' }, 400)
		}
		if (sortDir === null) {
			return c.json({ error: "sortDir must be 'asc' or 'desc'" }, 400)
		}
		const scheduleSortFields = [
			'name',
			'corporationId',
			'reportType',
			'format',
			'frequency',
			'isActive',
			'nextRunAt',
			'lastRunAt',
		] as const
		if (sortBy && !scheduleSortFields.includes(sortBy as (typeof scheduleSortFields)[number])) {
			return c.json({ error: `sortBy must be one of: ${scheduleSortFields.join(', ')}` }, 400)
		}

		const canRead = await canAuditTaxFeature(c.env, user, corporationId)
		if (!canRead) {
			return c.json({ error: 'Forbidden' }, 403)
		}

		try {
			const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
			const schedules = await stub.listExportSchedules({
				corporationId,
				activeOnly,
				limit,
				offset,
				sortBy: sortBy as (typeof scheduleSortFields)[number] | undefined,
				sortDir: sortDir ?? undefined,
			})
			return c.json(schedules)
		} catch (error) {
			logTaxReportsRouteError(c, 'Error listing corporation tax export schedules', error, {
				userId: user.id,
				corporationId,
			})
			return c.json({ error: 'Failed to list export schedules' }, 500)
		}
	})
}
