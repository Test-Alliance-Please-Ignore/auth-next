import { isTaxIncomeRefType } from '@repo/corporation-tax'
import { logger, toErrorLogDetails } from '@repo/hono-helpers'

const SITE_ADMIN_ONLY_ALERT_TYPES = new Set([
	'discord_delivery_failed',
	'scheduled_operations_failed',
	'scheduled_export_failed',
	'ess_duplicate_records_detected',
	'ess_missing_records_detected',
])

export const TAX_FEATURE_FLAG_KEY = 'tax.portal.enabled'
export const TAX_EXPORT_FORMATS = new Set(['csv', 'xlsx'])
export const TAX_EXPORT_REPORT_TYPES = new Set([
	'summary',
	'total_taxes_by_corporation',
	'top_income_sources',
	'ess_payout',
	'compliance_over_time',
	'discrepancies',
	'bill_status',
])
export const TAX_EXPORT_SCHEDULE_FREQUENCIES = new Set(['weekly', 'monthly'])
export const TAX_LEDGER_SOURCE_TYPES = new Set([
	'corporation_wallet_journal',
	'corporation_wallet_transaction',
	'character_wallet_journal',
	'character_wallet_transaction',
])
export const TAX_TOTAL_TAXES_SORT_FIELDS = [
	'corporationId',
	'taxableItemCount',
	'assessmentCount',
	'taxDue',
	'taxPaid',
	'taxDelta',
	'lastAssessmentAt',
] as const
export const TAX_ESS_REPORT_SORT_FIELDS = [
	'entryDate',
	'amount',
	'corporationId',
	'division',
] as const
export const TAX_DISCREPANCY_SORT_FIELDS = [
	'createdAt',
	'severity',
	'discrepancyType',
	'corporationId',
] as const
export const TAX_MISSING_ESI_SORT_FIELDS = [
	'corporationId',
	'directorCount',
	'healthyDirectorCount',
	'lastVerified',
] as const
export const TAX_BILL_STATUS_SORT_FIELDS = [
	'assessmentId',
	'corporationId',
	'taxPeriodStart',
	'taxPeriodEnd',
	'billStatus',
	'issueDate',
	'dueDate',
	'taxDue',
	'taxPaid',
	'taxDelta',
] as const
export const TAX_RULE_PRIORITY_MIN = 0
export const TAX_RULE_PRIORITY_MAX = 100
export const SNOWFLAKE_REGEX = /^\d{17,20}$/

export type TaxBillingHttpStatus = 400 | 404 | 409 | 500
export type TaxBillingConfigHttpStatus = 400 | 404 | 409 | 500

export function logTaxRouteError(
	c: { req: { method: string; path: string; url: string } },
	message: string,
	error: unknown,
	context?: Record<string, unknown>
): void {
	const url = new URL(c.req.url)
	logger.error(message, {
		...toErrorLogDetails(error),
		method: c.req.method,
		path: c.req.path,
		query: Object.fromEntries(url.searchParams.entries()),
		...context,
	})
}

export function disposeRpcStub(stub: unknown): void {
	if (!stub || typeof stub !== 'object') {
		return
	}

	const symbolDispose = (stub as { [Symbol.dispose]?: () => void })[Symbol.dispose]
	if (typeof symbolDispose === 'function') {
		try {
			symbolDispose.call(stub)
		} catch {
			// Best effort only.
		}
		return
	}

	const dispose = (stub as { dispose?: () => void }).dispose
	if (typeof dispose === 'function') {
		try {
			dispose.call(stub)
		} catch {
			// Best effort only.
		}
	}
}

export function filterAlertsForUser<T extends { alertType: string }>(
	user: { is_admin: boolean },
	alerts: T[]
): T[] {
	if (user.is_admin) {
		return alerts
	}

	return alerts.filter((alert) => !SITE_ADMIN_ONLY_ALERT_TYPES.has(alert.alertType))
}

export function parseBooleanQueryParam(value: string | undefined): boolean | undefined {
	if (value === undefined) {
		return undefined
	}
	if (value === 'true' || value === '1') {
		return true
	}
	if (value === 'false' || value === '0') {
		return false
	}
	return undefined
}

export function parseIntegerQueryParam(value: string | undefined): number | undefined {
	if (!value) {
		return undefined
	}
	const parsed = Number(value)
	return Number.isInteger(parsed) ? parsed : undefined
}

export function parseDateQueryParam(value: string | undefined): Date | undefined | null {
	if (!value) {
		return undefined
	}
	const parsed = new Date(value)
	return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function parseSortDirectionQueryParam(
	value: string | undefined
): 'asc' | 'desc' | undefined | null {
	if (!value) {
		return undefined
	}
	if (value === 'asc' || value === 'desc') {
		return value
	}
	return null
}

export function parseReportWindowFiltersFromQuery(
	request: {
		query: (key: string) => string | undefined
	},
	options?: { allowedSortFields?: readonly string[] }
): {
	filters?: {
		corporationId?: string
		fromDate?: Date
		toDate?: Date
		division?: number
		refType?: string
		refTypes?: string[]
		firstPartyId?: string
		secondPartyId?: string
		minAmount?: string
		limit?: number
		offset?: number
		sortBy?: string
		sortDirection?: 'asc' | 'desc'
	}
	error?: string
} {
	const corporationId = request.query('corporationId') || undefined
	const fromDate = parseDateQueryParam(request.query('fromDate'))
	const toDate = parseDateQueryParam(request.query('toDate'))
	const division = parseIntegerQueryParam(request.query('division'))
	const refType = request.query('refType')?.trim() || undefined
	const refTypes = request
		.query('refTypes')
		?.split(',')
		.map((value) => value.trim())
		.filter(Boolean)
	const firstPartyId = request.query('firstPartyId')?.trim() || undefined
	const secondPartyId = request.query('secondPartyId')?.trim() || undefined
	const minAmount = request.query('minAmount')?.trim() || undefined
	const limit = parseIntegerQueryParam(request.query('limit'))
	const offset = parseIntegerQueryParam(request.query('offset'))
	const sortBy = request.query('sortBy') || undefined
	const sortDirection = parseSortDirectionQueryParam(request.query('sortDir'))

	if (fromDate === null) {
		return { error: 'fromDate must be a valid ISO date string' }
	}
	if (toDate === null) {
		return { error: 'toDate must be a valid ISO date string' }
	}
	if (fromDate && toDate && fromDate > toDate) {
		return { error: 'fromDate must be before or equal to toDate' }
	}
	if (division !== undefined && division < 1) {
		return { error: 'division must be an integer >= 1' }
	}
	if (refType && !isTaxIncomeRefType(refType)) {
		return { error: 'refType must be a valid tax income ref type' }
	}
	if (refTypes && refTypes.some((value) => !isTaxIncomeRefType(value))) {
		return { error: 'refTypes must only include valid tax income ref types' }
	}
	if (
		minAmount !== undefined &&
		(!Number.isFinite(Number(minAmount)) || Number.isNaN(Number(minAmount)))
	) {
		return { error: 'minAmount must be a numeric value' }
	}
	if (limit !== undefined && (limit < 1 || limit > 200)) {
		return { error: 'limit must be an integer between 1 and 200' }
	}
	if (offset !== undefined && offset < 0) {
		return { error: 'offset must be an integer >= 0' }
	}
	if (sortDirection === null) {
		return { error: "sortDir must be 'asc' or 'desc'" }
	}
	if (sortBy && options?.allowedSortFields && !options.allowedSortFields.includes(sortBy)) {
		return { error: `sortBy must be one of: ${options.allowedSortFields.join(', ')}` }
	}

	return {
		filters: {
			corporationId,
			fromDate: fromDate ?? undefined,
			toDate: toDate ?? undefined,
			division: division ?? undefined,
			refType,
			refTypes: refTypes && refTypes.length > 0 ? refTypes : undefined,
			firstPartyId,
			secondPartyId,
			minAmount,
			limit: limit ?? undefined,
			offset: offset ?? undefined,
			sortBy: sortBy ?? undefined,
			sortDirection: sortDirection ?? undefined,
		},
	}
}

export function parseRollupReportFiltersFromQuery(
	request: {
		query: (key: string) => string | undefined
	},
	options?: { allowedSortFields?: readonly string[] }
): {
	filters?: {
		corporationId?: string
		fromDate?: Date
		toDate?: Date
		limit?: number
		offset?: number
		sortBy?: string
		sortDirection?: 'asc' | 'desc'
	}
	error?: string
} {
	const corporationId = request.query('corporationId') || undefined
	const fromDate = parseDateQueryParam(request.query('fromDate'))
	const toDate = parseDateQueryParam(request.query('toDate'))
	const limit = parseIntegerQueryParam(request.query('limit'))
	const offset = parseIntegerQueryParam(request.query('offset'))
	const sortBy = request.query('sortBy') || undefined
	const sortDirection = parseSortDirectionQueryParam(request.query('sortDir'))

	if (fromDate === null) {
		return { error: 'fromDate must be a valid ISO date string' }
	}
	if (toDate === null) {
		return { error: 'toDate must be a valid ISO date string' }
	}
	if (fromDate && toDate && fromDate > toDate) {
		return { error: 'fromDate must be before or equal to toDate' }
	}
	if (limit !== undefined && (limit < 1 || limit > 200)) {
		return { error: 'limit must be an integer between 1 and 200' }
	}
	if (offset !== undefined && offset < 0) {
		return { error: 'offset must be an integer >= 0' }
	}
	if (sortDirection === null) {
		return { error: "sortDir must be 'asc' or 'desc'" }
	}
	if (sortBy && options?.allowedSortFields && !options.allowedSortFields.includes(sortBy)) {
		return { error: `sortBy must be one of: ${options.allowedSortFields.join(', ')}` }
	}

	return {
		filters: {
			corporationId,
			fromDate: fromDate ?? undefined,
			toDate: toDate ?? undefined,
			limit: limit ?? undefined,
			offset: offset ?? undefined,
			sortBy: sortBy ?? undefined,
			sortDirection: sortDirection ?? undefined,
		},
	}
}

export function mapTaxBillingError(
	error: unknown,
	defaultMessage: string
): { status: TaxBillingHttpStatus; message: string } {
	if (!(error instanceof Error)) {
		return { status: 500, message: defaultMessage }
	}

	switch (error.message) {
		case 'Assessment not found':
		case 'Linked bill not found':
		case 'Default billing configuration not found for this corporation':
		case 'Bill not found':
			return { status: 404, message: error.message }
		case 'Only corporation-scope assessments can be billed':
			return { status: 400, message: error.message }
		case 'Assessment must be finalized before billing':
		case 'Billing is not enabled for this corporation':
		case 'Default billing configuration is disabled for this corporation':
		case 'Billing payee configuration is incomplete':
		case "billingPayeeType must be 'character' or 'corporation'":
		case 'Assessment has no linked bill':
		case 'Only the issuer can cancel the bill':
		case 'Cannot cancel a paid bill':
		case 'Bill is already cancelled':
			return { status: 409, message: error.message }
		default:
			return { status: 500, message: defaultMessage }
	}
}

export function mapTaxBillingConfigError(
	error: unknown,
	defaultMessage: string
): { status: TaxBillingConfigHttpStatus; message: string } {
	if (!(error instanceof Error)) {
		return { status: 500, message: defaultMessage }
	}

	switch (error.message) {
		case 'Billing configuration not found':
		case 'Default billing configuration not found for this corporation':
			return { status: 404, message: error.message }
		case 'Cannot delete the only billing configuration for a corporation':
		case 'Cannot delete the default billing configuration':
		case 'Duplicate billing configuration tuple for corporation':
		case 'A corporation must have a default billing configuration':
			return { status: 409, message: error.message }
		case "billingPayeeType must be 'character' or 'corporation'":
		case 'billingPayeeId and billingPayeeType are required':
		case 'billingPayeeId and billingPayeeType must be provided together':
		case 'billingPayeeId must not be empty':
		case 'billingDueDays must be an integer between 1 and 90':
			return { status: 400, message: error.message }
		default:
			return { status: 500, message: defaultMessage }
	}
}

export function parseAuditLogFiltersFromQuery(request: {
	query: (key: string) => string | undefined
}): {
	filters?: {
		corporationId?: string
		actorUserId?: string
		action?: string
		fromDate?: Date
		toDate?: Date
		limit?: number
		offset?: number
	}
	error?: string
} {
	const corporationId = request.query('corporationId') || undefined
	const actorUserId = request.query('actorUserId') || undefined
	const action = request.query('action') || undefined
	const fromDate = parseDateQueryParam(request.query('fromDate'))
	const toDate = parseDateQueryParam(request.query('toDate'))
	const limit = parseIntegerQueryParam(request.query('limit'))
	const offset = parseIntegerQueryParam(request.query('offset'))

	if (fromDate === null) {
		return { error: 'fromDate must be a valid ISO date string' }
	}
	if (toDate === null) {
		return { error: 'toDate must be a valid ISO date string' }
	}
	if (fromDate && toDate && fromDate > toDate) {
		return { error: 'fromDate must be before or equal to toDate' }
	}
	if (limit !== undefined && (limit < 1 || limit > 200)) {
		return { error: 'limit must be an integer between 1 and 200' }
	}
	if (offset !== undefined && offset < 0) {
		return { error: 'offset must be an integer greater than or equal to 0' }
	}

	return {
		filters: {
			corporationId,
			actorUserId,
			action,
			fromDate: fromDate ?? undefined,
			toDate: toDate ?? undefined,
			limit: limit ?? undefined,
			offset: offset ?? undefined,
		},
	}
}
