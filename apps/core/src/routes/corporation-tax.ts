import { Hono } from 'hono'

import { isTaxIncomeRefType } from '@repo/corporation-tax'
import { and, desc, eq, ilike, inArray, or } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'
import { logger, TimeCache } from '@repo/hono-helpers'

import { discordServers, managedCorporations, userCharacters } from '../db/schema'
import { requireAuth } from '../middleware/session'
import {
	canAuditTaxFeature,
	canManageTaxFeature,
	canReadTaxFeature,
	getTaxCharacterIds,
} from '../middleware/tax-permissions'

import type { CorporationTax } from '@repo/corporation-tax'
import type { EveCharacterData } from '@repo/eve-character-data'
import type { EveCorporationData } from '@repo/eve-corporation-data'
import type { EveTokenStore } from '@repo/eve-token-store'
import type { Features } from '@repo/features'
import type { App, SessionUser } from '../context'

const app = new Hono<App>()
const corpMembershipCache = new TimeCache<string[]>(60_000)
const TAX_FEATURE_FLAG_KEY = 'tax.portal.enabled'
const TAX_EXPORT_FORMATS = new Set(['csv', 'xlsx'])
const TAX_EXPORT_REPORT_TYPES = new Set([
	'summary',
	'total_taxes_by_corporation',
	'top_income_sources',
	'ess_payout',
	'compliance_over_time',
	'discrepancies',
	'bill_status',
])
const TAX_EXPORT_SCHEDULE_FREQUENCIES = new Set(['weekly', 'monthly'])
const TAX_LEDGER_SOURCE_TYPES = new Set([
	'corporation_wallet_journal',
	'corporation_wallet_transaction',
	'character_wallet_journal',
	'character_wallet_transaction',
])
const TAX_TOTAL_TAXES_SORT_FIELDS = [
	'corporationId',
	'assessmentCount',
	'taxDue',
	'taxPaid',
	'taxDelta',
	'lastAssessmentAt',
] as const
const TAX_ESS_REPORT_SORT_FIELDS = [
	'entryDate',
	'amount',
	'corporationId',
	'division',
	'essBankType',
] as const
const TAX_DISCREPANCY_SORT_FIELDS = [
	'createdAt',
	'severity',
	'discrepancyType',
	'corporationId',
] as const
const TAX_MISSING_ESI_SORT_FIELDS = [
	'corporationId',
	'directorCount',
	'healthyDirectorCount',
	'lastVerified',
] as const
const TAX_BILL_STATUS_SORT_FIELDS = [
	'corporationId',
	'billStatus',
	'assessmentCount',
	'taxDue',
	'taxPaid',
	'taxDelta',
] as const
const SNOWFLAKE_REGEX = /^\d{17,20}$/
const SITE_ADMIN_ONLY_ALERT_TYPES = new Set([
	'discord_delivery_failed',
	'scheduled_operations_failed',
	'scheduled_export_failed',
	'ess_duplicate_records_detected',
	'ess_missing_records_detected',
])

function filterAlertsForUser<T extends { alertType: string }>(user: SessionUser, alerts: T[]): T[] {
	if (user.is_admin) {
		return alerts
	}

	return alerts.filter((alert) => !SITE_ADMIN_ONLY_ALERT_TYPES.has(alert.alertType))
}

async function isTaxFeatureEnabled(env: App['Bindings']): Promise<boolean> {
	const featuresNamespace = env.FEATURES
	if (!featuresNamespace) {
		return true
	}

	try {
		const featuresStub = getStub<Features>(featuresNamespace, 'default')
		const rawValue = await featuresStub.checkFlag(TAX_FEATURE_FLAG_KEY)
		if (rawValue === null) {
			return true
		}
		return rawValue === true
	} catch (error) {
		logger.warn('[CorporationTax] Failed to resolve feature flag, defaulting enabled', {
			flagKey: TAX_FEATURE_FLAG_KEY,
			error: error instanceof Error ? error.message : String(error),
		})
		return true
	}
}

app.use('*', async (c, next) => {
	const featureEnabled = await isTaxFeatureEnabled(c.env)
	if (!featureEnabled) {
		return c.json({ error: 'Corporation tax feature is disabled' }, 404)
	}
	await next()
})

function parseBooleanQueryParam(value: string | undefined): boolean | undefined {
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

function parseIntegerQueryParam(value: string | undefined): number | undefined {
	if (!value) {
		return undefined
	}
	const parsed = Number(value)
	return Number.isInteger(parsed) ? parsed : undefined
}

async function validateBillingPayeeSelection(
	db: App['Variables']['db'],
	input: {
		billingPayeeId?: string
		billingPayeeType?: '' | 'character' | 'corporation'
	},
	options: { partial: boolean }
): Promise<{ ok: true } | { ok: false; error: string }> {
	const hasPayeeId = typeof input.billingPayeeId === 'string'
	const hasPayeeType = typeof input.billingPayeeType === 'string'

	if (options.partial) {
		if (!hasPayeeId && !hasPayeeType) {
			return { ok: true }
		}
		if (!hasPayeeId || !hasPayeeType) {
			return { ok: false, error: 'billingPayeeId and billingPayeeType must be provided together' }
		}
	} else {
		if (!hasPayeeId || !hasPayeeType) {
			return { ok: false, error: 'billingPayeeId and billingPayeeType are required' }
		}
	}

	const payeeId = input.billingPayeeId?.trim() ?? ''
	const payeeType = input.billingPayeeType

	if (!payeeId) {
		return { ok: false, error: 'billingPayeeId must not be empty' }
	}
	if (payeeType !== 'character' && payeeType !== 'corporation') {
		return { ok: false, error: "billingPayeeType must be 'character' or 'corporation'" }
	}

	if (!db) {
		return { ok: false, error: 'Database unavailable' }
	}

	if (payeeType === 'character') {
		const row = await db.query.userCharacters.findFirst({
			where: eq(userCharacters.characterId, payeeId),
			columns: { characterId: true },
		})
		if (!row) {
			return { ok: false, error: 'Selected character payee was not found' }
		}
		return { ok: true }
	}

	const corpRow = await db.query.managedCorporations.findFirst({
		where: and(
			eq(managedCorporations.corporationId, payeeId),
			eq(managedCorporations.isActive, true)
		),
		columns: { corporationId: true },
	})
	if (!corpRow) {
		return { ok: false, error: 'Selected corporation payee was not found or is inactive' }
	}
	return { ok: true }
}

function parseDateQueryParam(value: string | undefined): Date | undefined | null {
	if (!value) {
		return undefined
	}
	const parsed = new Date(value)
	return Number.isNaN(parsed.getTime()) ? null : parsed
}

function parseSortDirectionQueryParam(
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

function parseReportWindowFiltersFromQuery(
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
		return {
			error: `sortBy must be one of: ${options.allowedSortFields.join(', ')}`,
		}
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

type TaxBillingHttpStatus = 400 | 404 | 409 | 500
type TaxBillingConfigHttpStatus = 400 | 404 | 409 | 500

function mapTaxBillingError(
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
		case 'Assessment has no linked bill':
		case 'Only the issuer can cancel the bill':
		case 'Cannot cancel a paid bill':
		case 'Bill is already cancelled':
			return { status: 409, message: error.message }
		default:
			return { status: 500, message: defaultMessage }
	}
}

function mapTaxBillingConfigError(
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
		case "billingPayeeType must be '', 'character', or 'corporation'":
		case 'billingDueDays must be an integer between 1 and 90':
			return { status: 400, message: error.message }
		default:
			return { status: 500, message: defaultMessage }
	}
}

function parseAuditLogFiltersFromQuery(request: { query: (key: string) => string | undefined }): {
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
		return { error: 'offset must be an integer >= 0' }
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

async function validateDiscordDestinationInput(
	c: { get: (key: 'db') => App['Variables']['db'] | undefined },
	guildId: string,
	channelId: string
): Promise<string | null> {
	if (!SNOWFLAKE_REGEX.test(guildId)) {
		return 'guildId must be a valid Discord snowflake'
	}
	if (!SNOWFLAKE_REGEX.test(channelId)) {
		return 'channelId must be a valid Discord snowflake'
	}

	const db = c.get('db')
	if (!db) {
		return 'Database not available'
	}

	const server = await db.query.discordServers.findFirst({
		where: and(eq(discordServers.guildId, guildId), eq(discordServers.isActive, true)),
	})
	if (!server) {
		return 'guildId is not an active Discord server in the registry'
	}

	return null
}

async function getMemberCharacterIdsInCorporation(
	c: { env: App['Bindings'] },
	user: SessionUser,
	corporationId: string
): Promise<string[]> {
	const characterIds = getTaxCharacterIds(user)
	if (characterIds.length === 0) {
		return []
	}

	if (user.is_admin) {
		return characterIds
	}

	const cacheKey = `${user.id}:${corporationId}:member-character-ids`
	return corpMembershipCache.getOrSet(cacheKey, async () => {
		const memberships = await Promise.all(
			characterIds.map(async (characterId) => {
				try {
					const characterStub = getStub<EveCharacterData>(c.env.EVE_CHARACTER_DATA, characterId)
					const characterInfo = await characterStub.getCharacterInfo(characterId)
					if (!characterInfo || String(characterInfo.corporationId) !== corporationId) {
						return null
					}
					return characterId
				} catch (error) {
					logger.warn('[CorporationTax] Failed character membership lookup for member summary', {
						userId: user.id,
						corporationId,
						characterId,
						error: error instanceof Error ? error.message : String(error),
					})
					return null
				}
			})
		)

		return memberships.filter((characterId): characterId is string => characterId !== null)
	})
}

/**
 * GET /corporation-tax/health
 * Temporary integration route for validating core <-> corporation-tax RPC wiring.
 */
app.get('/health', requireAuth(), async (c) => {
	try {
		const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
		const health = await stub.getHealth()
		return c.json(health)
	} catch (error) {
		logger.error('Error fetching corporation-tax health:', error)
		return c.json({ error: 'Failed to fetch corporation-tax health' }, 500)
	}
})

/**
 * GET /corporation-tax/capabilities
 * Resolve tax feature capabilities for current user globally and optional corporation scope.
 */
app.get('/capabilities', requireAuth(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	const corporationId = c.req.query('corporationId')?.trim() || undefined

	const [globalCanRead, globalCanAudit, globalCanManage] = await Promise.all([
		canReadTaxFeature(c.env, user),
		canAuditTaxFeature(c.env, user),
		canManageTaxFeature(c.env, user),
	])

	const [scopedCanRead, scopedCanAudit, scopedCanManage] = corporationId
		? await Promise.all([
				canReadTaxFeature(c.env, user, corporationId),
				canAuditTaxFeature(c.env, user, corporationId),
				canManageTaxFeature(c.env, user, corporationId),
			])
		: [globalCanRead, globalCanAudit, globalCanManage]

	return c.json({
		corporationId: corporationId ?? null,
		global: {
			canRead: globalCanRead,
			canAudit: globalCanAudit,
			canManage: globalCanManage,
		},
		scoped: {
			canRead: scopedCanRead,
			canAudit: scopedCanAudit,
			canManage: scopedCanManage,
		},
	})
})

/**
 * GET /corporation-tax/exclusions
 * List corporation exclusions.
 */
app.get('/exclusions', requireAuth(), async (c) => {
	const user = c.get('user')
	if (!user) return c.json({ error: 'Unauthorized' }, 401)
	const canRead = await canManageTaxFeature(c.env, user)
	if (!canRead) return c.json({ error: 'Forbidden' }, 403)

	const limit = parseIntegerQueryParam(c.req.query('limit'))
	const offset = parseIntegerQueryParam(c.req.query('offset'))
	if (limit !== undefined && (limit < 1 || limit > 200)) {
		return c.json({ error: 'limit must be between 1 and 200' }, 400)
	}
	if (offset !== undefined && offset < 0) {
		return c.json({ error: 'offset must be >= 0' }, 400)
	}

	try {
		const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
		return c.json(await stub.listCorporationExclusions({ limit, offset }))
	} catch (error) {
		logger.error('Error listing corporation tax exclusions:', error)
		return c.json({ error: 'Failed to list corporation tax exclusions' }, 500)
	}
})

/**
 * PUT /corporation-tax/exclusions/:corporationId
 * Upsert corporation exclusion reason.
 */
app.put('/exclusions/:corporationId', requireAuth(), async (c) => {
	const user = c.get('user')
	if (!user) return c.json({ error: 'Unauthorized' }, 401)
	const canWrite = await canManageTaxFeature(c.env, user)
	if (!canWrite) return c.json({ error: 'Forbidden' }, 403)

	const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null
	if (!body) return c.json({ error: 'Invalid JSON payload' }, 400)
	if (!('reason' in body)) return c.json({ error: 'reason is required' }, 400)
	if (!(typeof body.reason === 'string' || body.reason === null)) {
		return c.json({ error: 'reason must be a string or null' }, 400)
	}

	try {
		const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
		return c.json(
			await stub.upsertCorporationExclusion(user.id, c.req.param('corporationId'), {
				reason: body.reason as string | null,
			})
		)
	} catch (error) {
		logger.error('Error upserting corporation tax exclusion:', error)
		return c.json({ error: 'Failed to upsert corporation tax exclusion' }, 500)
	}
})

/**
 * DELETE /corporation-tax/exclusions/:corporationId
 * Remove corporation exclusion.
 */
app.delete('/exclusions/:corporationId', requireAuth(), async (c) => {
	const user = c.get('user')
	if (!user) return c.json({ error: 'Unauthorized' }, 401)
	const canWrite = await canManageTaxFeature(c.env, user)
	if (!canWrite) return c.json({ error: 'Forbidden' }, 403)

	try {
		const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
		await stub.deleteCorporationExclusion(user.id, c.req.param('corporationId'))
		return c.body(null, 204)
	} catch (error) {
		logger.error('Error deleting corporation tax exclusion:', error)
		return c.json({ error: 'Failed to delete corporation tax exclusion' }, 500)
	}
})

/**
 * GET /corporation-tax/corporations
 * List member/special-purpose corporations with exclusion flags.
 */
app.get('/corporations', requireAuth(), async (c) => {
	const user = c.get('user')
	if (!user) return c.json({ error: 'Unauthorized' }, 401)
	const canRead = await canAuditTaxFeature(c.env, user)
	if (!canRead) return c.json({ error: 'Forbidden' }, 403)

	const limit = parseIntegerQueryParam(c.req.query('limit'))
	const offset = parseIntegerQueryParam(c.req.query('offset'))
	if (limit !== undefined && (limit < 1 || limit > 300)) {
		return c.json({ error: 'limit must be between 1 and 300' }, 400)
	}
	if (offset !== undefined && offset < 0) {
		return c.json({ error: 'offset must be >= 0' }, 400)
	}

	try {
		const db = c.get('db')
		if (!db) {
			return c.json({ error: 'Database unavailable' }, 500)
		}

		const managedCorps = await db.query.managedCorporations.findMany({
			where: and(
				eq(managedCorporations.isActive, true),
				eq(managedCorporations.isMemberCorporation, true)
			),
			orderBy: [desc(managedCorporations.updatedAt)],
			limit: 500,
		})

		const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
		const exclusions = await stub.listCorporationExclusions({ limit: 10_000 })
		const exclusionMap = new Map(
			exclusions.map((row) => [row.corporationId, row.reason ?? null] as const)
		)

		const rows = managedCorps.map((corp) => ({
			corporationId: corp.corporationId,
			included: !exclusionMap.has(corp.corporationId),
			exclusionReason: exclusionMap.get(corp.corporationId) ?? null,
			createdAt: corp.createdAt,
			updatedAt: corp.updatedAt,
		}))
		const boundedLimit = Math.min(Math.max(limit ?? 200, 1), 300)
		const boundedOffset = Math.max(offset ?? 0, 0)
		return c.json(rows.slice(boundedOffset, boundedOffset + boundedLimit))
	} catch (error) {
		logger.error('Error listing tax corporations:', error)
		return c.json({ error: 'Failed to list tax corporations' }, 500)
	}
})

/**
 * GET /corporation-tax/corporations/:corporationId/payee-corporations/search?q=:query
 * Search all active corporations for billing payee selection.
 */
app.get('/corporations/:corporationId/payee-corporations/search', requireAuth(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	const corporationId = c.req.param('corporationId')
	const canManage = await canManageTaxFeature(c.env, user, corporationId)
	if (!canManage) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	const query = c.req.query('q')?.trim()
	if (!query || query.length < 2) {
		return c.json({ error: 'q must be at least 2 characters' }, 400)
	}

	const db = c.get('db')
	if (!db) {
		return c.json({ error: 'Database unavailable' }, 500)
	}

	const isNumeric = /^[0-9]+$/.test(query)

	try {
		const rows = await db.query.managedCorporations.findMany({
			where: and(
				eq(managedCorporations.isActive, true),
				isNumeric
					? or(
							eq(managedCorporations.corporationId, query),
							ilike(managedCorporations.name, `%${query}%`)
						)
					: ilike(managedCorporations.name, `%${query}%`)
			),
			orderBy: [desc(managedCorporations.updatedAt)],
			limit: 25,
			columns: {
				corporationId: true,
				name: true,
			},
		})
		return c.json(rows)
	} catch (error) {
		logger.error('Error searching active billing payee corporations:', error)
		return c.json({ error: 'Failed to search active corporations' }, 500)
	}
})

/**
 * GET /corporation-tax/corporations/:corporationId/divisions
 * List known wallet divisions for a corporation.
 * Requires tax viewer+ permission, or CEO/director self-service access for that corporation.
 */
app.get('/corporations/:corporationId/divisions', requireAuth(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	const corporationId = c.req.param('corporationId')
	const canRead = await canReadTaxFeature(c.env, user, corporationId)
	if (!canRead) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	try {
		const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
		const divisions = await stub.listWalletDivisions(corporationId)
		return c.json(divisions.sort((left, right) => left - right))
	} catch (error) {
		logger.error('Error listing corporation tax wallet divisions:', error)
		return c.json({ error: 'Failed to list wallet divisions' }, 500)
	}
})

/**
 * GET /corporation-tax/corporations/:corporationId/rules
 * List tax rule sets for a corporation.
 */
app.get('/corporations/:corporationId/rules', requireAuth(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	const corporationId = c.req.param('corporationId')
	const canManage = await canManageTaxFeature(c.env, user, corporationId)
	if (!canManage) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	const onlyActive = parseBooleanQueryParam(c.req.query('onlyActive'))
	const ruleGroupId = c.req.query('ruleGroupId') || undefined
	const limit = parseIntegerQueryParam(c.req.query('limit'))
	const offset = parseIntegerQueryParam(c.req.query('offset'))

	try {
		const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
		const ruleSets = await stub.listRuleSets({
			corporationId,
			ruleGroupId,
			onlyActive,
			limit,
			offset,
		})
		return c.json(ruleSets)
	} catch (error) {
		logger.error('Error listing corporation tax rules:', error)
		return c.json({ error: 'Failed to list corporation tax rules' }, 500)
	}
})

/**
 * GET /corporation-tax/rules
 * List tax rule sets scoped by rule group and/or corporation.
 */
app.get('/rules', requireAuth(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	const corporationId = c.req.query('corporationId') || undefined
	const ruleGroupId = c.req.query('ruleGroupId') || undefined
	const canManage = corporationId
		? await canManageTaxFeature(c.env, user, corporationId)
		: await canManageTaxFeature(c.env, user)
	if (!canManage) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	const onlyActive = parseBooleanQueryParam(c.req.query('onlyActive'))
	const limit = parseIntegerQueryParam(c.req.query('limit'))
	const offset = parseIntegerQueryParam(c.req.query('offset'))

	try {
		const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
		const ruleSets = await stub.listRuleSets({
			corporationId,
			ruleGroupId,
			onlyActive,
			limit,
			offset,
		})
		return c.json(ruleSets)
	} catch (error) {
		logger.error('Error listing tax rules:', error)
		return c.json({ error: 'Failed to list tax rules' }, 500)
	}
})

/**
 * GET /corporation-tax/rule-groups
 * List tax rule groups, optionally scoped to one corporation attachment view.
 */
app.get('/rule-groups', requireAuth(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	const corporationId = c.req.query('corporationId') || undefined
	const canManage = corporationId
		? await canManageTaxFeature(c.env, user, corporationId)
		: await canManageTaxFeature(c.env, user)
	if (!canManage) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	try {
		const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
		const ruleGroups = await stub.listRuleGroups({
			corporationId,
			limit: 200,
		})
		return c.json(ruleGroups)
	} catch (error) {
		logger.error('Error listing corporation tax rule groups:', error)
		return c.json({ error: 'Failed to list corporation tax rule groups' }, 500)
	}
})

/**
 * POST /corporation-tax/rule-groups
 * Create a tax rule group.
 */
app.post('/rule-groups', requireAuth(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	const canWrite = await canManageTaxFeature(c.env, user)
	if (!canWrite) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	let body: Record<string, unknown>
	try {
		body = await c.req.json()
	} catch (_error) {
		return c.json({ error: 'Invalid JSON payload' }, 400)
	}

	const name = typeof body.name === 'string' ? body.name.trim() : ''
	if (!name) {
		return c.json({ error: 'name is required' }, 400)
	}
	const description =
		typeof body.description === 'string' ? body.description.trim() || null : undefined

	try {
		const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
		const created = await stub.createRuleGroup(user.id, {
			name,
			description,
		})
		return c.json(created, 201)
	} catch (error) {
		logger.error('Error creating corporation tax rule group:', error)
		return c.json({ error: 'Failed to create corporation tax rule group' }, 500)
	}
})

app.patch('/rule-groups/:ruleGroupId', requireAuth(), async (c) => {
	const user = c.get('user')
	if (!user) return c.json({ error: 'Unauthorized' }, 401)
	const canWrite = await canManageTaxFeature(c.env, user)
	if (!canWrite) return c.json({ error: 'Forbidden' }, 403)

	const ruleGroupId = c.req.param('ruleGroupId')
	const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null
	if (!body) return c.json({ error: 'Invalid JSON payload' }, 400)

	const input: { name?: string; description?: string | null } = {}
	if ('name' in body) {
		if (typeof body.name !== 'string') return c.json({ error: 'name must be a string' }, 400)
		input.name = body.name
	}
	if ('description' in body) {
		if (!(typeof body.description === 'string' || body.description === null)) {
			return c.json({ error: 'description must be a string or null' }, 400)
		}
		input.description = body.description
	}
	try {
		const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
		return c.json(await stub.updateRuleGroup(user.id, ruleGroupId, input))
	} catch (error) {
		if (error instanceof Error && error.message.includes('cannot be updated')) {
			return c.json({ error: error.message }, 409)
		}
		logger.error('Error updating tax rule group:', error)
		return c.json({ error: 'Failed to update tax rule group' }, 500)
	}
})

app.delete('/rule-groups/:ruleGroupId', requireAuth(), async (c) => {
	const user = c.get('user')
	if (!user) return c.json({ error: 'Unauthorized' }, 401)
	const canWrite = await canManageTaxFeature(c.env, user)
	if (!canWrite) return c.json({ error: 'Forbidden' }, 403)
	const ruleGroupId = c.req.param('ruleGroupId')
	try {
		const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
		await stub.deleteRuleGroup(user.id, ruleGroupId)
		return c.body(null, 204)
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		if (message.includes('cannot be deleted')) {
			return c.json({ error: message }, 409)
		}
		logger.error('Error deleting tax rule group:', error)
		return c.json({ error: 'Failed to delete tax rule group' }, 500)
	}
})

app.get('/rule-groups/:ruleGroupId/attachments', requireAuth(), async (c) => {
	const user = c.get('user')
	if (!user) return c.json({ error: 'Unauthorized' }, 401)
	const canRead = await canManageTaxFeature(c.env, user)
	if (!canRead) return c.json({ error: 'Forbidden' }, 403)
	const ruleGroupId = c.req.param('ruleGroupId')
	try {
		const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
		return c.json(await stub.listRuleGroupAttachments(ruleGroupId))
	} catch (error) {
		logger.error('Error listing tax rule group attachments:', error)
		return c.json({ error: 'Failed to list tax rule group attachments' }, 500)
	}
})

app.post('/rule-groups/:ruleGroupId/attachments', requireAuth(), async (c) => {
	const user = c.get('user')
	if (!user) return c.json({ error: 'Unauthorized' }, 401)
	const canWrite = await canManageTaxFeature(c.env, user)
	if (!canWrite) return c.json({ error: 'Forbidden' }, 403)
	const ruleGroupId = c.req.param('ruleGroupId')
	const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null
	const corporationId = typeof body?.corporationId === 'string' ? body.corporationId.trim() : ''
	if (!corporationId) return c.json({ error: 'corporationId is required' }, 400)
	try {
		const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
		const attached = await stub.attachCorporationToRuleGroup(user.id, ruleGroupId, corporationId)
		return c.json(attached, 201)
	} catch (error) {
		logger.error('Error attaching corporation to tax rule group:', error)
		return c.json({ error: 'Failed to attach corporation to tax rule group' }, 500)
	}
})

app.delete('/rule-groups/:ruleGroupId/attachments/:corporationId', requireAuth(), async (c) => {
	const user = c.get('user')
	if (!user) return c.json({ error: 'Unauthorized' }, 401)
	const canWrite = await canManageTaxFeature(c.env, user)
	if (!canWrite) return c.json({ error: 'Forbidden' }, 403)
	const ruleGroupId = c.req.param('ruleGroupId')
	const corporationId = c.req.param('corporationId')
	try {
		const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
		await stub.detachCorporationFromRuleGroup(user.id, ruleGroupId, corporationId)
		return c.body(null, 204)
	} catch (error) {
		logger.error('Error detaching corporation from tax rule group:', error)
		return c.json({ error: 'Failed to detach corporation from tax rule group' }, 500)
	}
})

app.post('/rules', requireAuth(), async (c) => {
	const user = c.get('user')
	if (!user) return c.json({ error: 'Unauthorized' }, 401)
	const canWrite = await canManageTaxFeature(c.env, user)
	if (!canWrite) return c.json({ error: 'Forbidden' }, 403)

	const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null
	if (!body) return c.json({ error: 'Invalid JSON payload' }, 400)
	const ruleGroupId = typeof body.ruleGroupId === 'string' ? body.ruleGroupId : ''
	const name = typeof body.name === 'string' ? body.name.trim() : ''
	if (!ruleGroupId) return c.json({ error: 'ruleGroupId is required' }, 400)
	if (!name) return c.json({ error: 'name is required' }, 400)

	const priority =
		typeof body.priority === 'number' && Number.isInteger(body.priority) ? body.priority : 0
	const isActive = typeof body.isActive === 'boolean' ? body.isActive : true
	const parseDateOrUndefined = (value: unknown): Date | undefined => {
		if (typeof value !== 'string') return undefined
		const parsed = new Date(value)
		return Number.isNaN(parsed.getTime()) ? undefined : parsed
	}
	const effectiveFrom = parseDateOrUndefined(body.effectiveFrom)
	const effectiveTo = parseDateOrUndefined(body.effectiveTo)
	const taxRateBps =
		typeof body.taxRateBps === 'number' && Number.isInteger(body.taxRateBps) ? body.taxRateBps : -1
	const label = typeof body.label === 'string' ? body.label : ''
	if (taxRateBps < 0 || taxRateBps > 10_000) {
		return c.json({ error: 'taxRateBps must be an integer between 0 and 10000' }, 400)
	}
	if (!label.trim()) {
		return c.json({ error: 'label is required' }, 400)
	}
	const appliesToRefTypeRaw =
		typeof body.appliesToRefType === 'string' ? body.appliesToRefType.trim() : undefined
	const appliesToRefType = appliesToRefTypeRaw || undefined
	if (appliesToRefType && !isTaxIncomeRefType(appliesToRefType)) {
		return c.json({ error: 'appliesToRefType must be a valid tax income ref type' }, 400)
	}
	try {
		const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
		const created = await stub.createRuleSet(user.id, {
			ruleGroupId,
			name,
			priority,
			isActive,
			effectiveFrom,
			effectiveTo,
			appliesToRefType,
			partyType: typeof body.partyType === 'string' ? body.partyType : undefined,
			taxRateBps,
			label,
		})
		return c.json(created, 201)
	} catch (error) {
		logger.error('Error creating tax rule set:', error)
		return c.json({ error: 'Failed to create tax rule set' }, 500)
	}
})

app.patch('/rules/:ruleSetId', requireAuth(), async (c) => {
	const user = c.get('user')
	if (!user) return c.json({ error: 'Unauthorized' }, 401)
	const canWrite = await canManageTaxFeature(c.env, user)
	if (!canWrite) return c.json({ error: 'Forbidden' }, 403)
	const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null
	if (!body) return c.json({ error: 'Invalid JSON payload' }, 400)
	const ruleSetId = c.req.param('ruleSetId')
	const parseDateOrUndefined = (value: unknown): Date | undefined => {
		if (typeof value !== 'string') return undefined
		const parsed = new Date(value)
		return Number.isNaN(parsed.getTime()) ? undefined : parsed
	}
	try {
		const appliesToRefTypeRaw =
			typeof body.appliesToRefType === 'string' ? body.appliesToRefType.trim() : undefined
		const appliesToRefType = appliesToRefTypeRaw || undefined
		if (appliesToRefType && !isTaxIncomeRefType(appliesToRefType)) {
			return c.json({ error: 'appliesToRefType must be a valid tax income ref type' }, 400)
		}

		const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
		const updated = await stub.updateRuleSet(user.id, ruleSetId, {
			isActive: typeof body.isActive === 'boolean' ? body.isActive : undefined,
			name: typeof body.name === 'string' ? body.name : undefined,
			priority:
				typeof body.priority === 'number' && Number.isInteger(body.priority)
					? body.priority
					: undefined,
			effectiveFrom: parseDateOrUndefined(body.effectiveFrom),
			effectiveTo: parseDateOrUndefined(body.effectiveTo),
			appliesToRefType,
			partyType: typeof body.partyType === 'string' ? body.partyType : undefined,
			taxRateBps:
				typeof body.taxRateBps === 'number' && Number.isInteger(body.taxRateBps)
					? body.taxRateBps
					: undefined,
			label: typeof body.label === 'string' ? body.label : undefined,
		})
		return c.json(updated)
	} catch (error) {
		logger.error('Error updating tax rule set:', error)
		return c.json({ error: 'Failed to update tax rule set' }, 500)
	}
})

app.delete('/rules/:ruleSetId', requireAuth(), async (c) => {
	const user = c.get('user')
	if (!user) return c.json({ error: 'Unauthorized' }, 401)
	const canWrite = await canManageTaxFeature(c.env, user)
	if (!canWrite) return c.json({ error: 'Forbidden' }, 403)
	const ruleSetId = c.req.param('ruleSetId')
	try {
		const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
		await stub.deleteRuleSet(user.id, ruleSetId)
		return c.body(null, 204)
	} catch (error) {
		if (error instanceof Error && error.message.includes('not found')) {
			return c.json({ error: error.message }, 404)
		}
		logger.error('Error deleting tax rule set:', error)
		return c.json({ error: 'Failed to delete tax rule set' }, 500)
	}
})

/**
 * GET /corporation-tax/corporations/:corporationId/assessments
 * List tax assessments for a corporation.
 */
app.get('/corporations/:corporationId/assessments', requireAuth(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	const corporationId = c.req.param('corporationId')
	const canManage = await canManageTaxFeature(c.env, user, corporationId)
	if (!canManage) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	const status = c.req.query('status')
	const assessmentScope = c.req.query('assessmentScope')
	const withBillOnly = parseBooleanQueryParam(c.req.query('withBillOnly'))
	const limit = parseIntegerQueryParam(c.req.query('limit'))
	const offset = parseIntegerQueryParam(c.req.query('offset'))

	try {
		const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
		const assessments = await stub.listAssessments({
			corporationId,
			status:
				status === 'draft' ||
				status === 'underpaid' ||
				status === 'paid' ||
				status === 'overpaid' ||
				status === 'excluded'
					? status
					: undefined,
			assessmentScope:
				assessmentScope === 'corporation' ||
				assessmentScope === 'division' ||
				assessmentScope === 'character'
					? assessmentScope
					: undefined,
			withBillOnly,
			limit,
			offset,
		})
		return c.json(assessments)
	} catch (error) {
		logger.error('Error listing corporation tax assessments:', error)
		return c.json({ error: 'Failed to list tax assessments' }, 500)
	}
})

/**
 * POST /corporation-tax/corporations/:corporationId/assessments/run
 * Compute or recompute a corporation-level assessment for a period.
 */
app.post('/corporations/:corporationId/assessments/run', requireAuth(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	const corporationId = c.req.param('corporationId')
	const canRun = await canManageTaxFeature(c.env, user, corporationId)
	if (!canRun) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	let body: Record<string, unknown>
	try {
		body = await c.req.json()
	} catch (_error) {
		return c.json({ error: 'Invalid JSON payload' }, 400)
	}

	const periodStart = typeof body.periodStart === 'string' ? new Date(body.periodStart) : null
	const periodEnd = typeof body.periodEnd === 'string' ? new Date(body.periodEnd) : null
	if (!periodStart || Number.isNaN(periodStart.getTime())) {
		return c.json({ error: 'periodStart must be a valid ISO date string' }, 400)
	}
	if (!periodEnd || Number.isNaN(periodEnd.getTime())) {
		return c.json({ error: 'periodEnd must be a valid ISO date string' }, 400)
	}
	if (periodStart >= periodEnd) {
		return c.json({ error: 'periodStart must be before periodEnd' }, 400)
	}

	try {
		const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
		const result = await stub.runAssessmentForPeriod(user.id, {
			corporationId,
			periodStart,
			periodEnd,
			// Static override: keep assessments corporation-wallet only for now.
			includeCharacterWallets: false,
		})
		return c.json(result)
	} catch (error) {
		logger.error('Error running tax assessment for period:', error)
		return c.json({ error: 'Failed to run tax assessment for period' }, 500)
	}
})

/**
 * POST /corporation-tax/corporations/:corporationId/assessments/rebuild-finalized
 * Explicitly rebuild closed-period finalized rollups for one corporation window.
 */
app.post('/corporations/:corporationId/assessments/rebuild-finalized', requireAuth(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	const corporationId = c.req.param('corporationId')
	const canRun = await canManageTaxFeature(c.env, user, corporationId)
	if (!canRun) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	let body: Record<string, unknown>
	try {
		body = await c.req.json()
	} catch (_error) {
		return c.json({ error: 'Invalid JSON payload' }, 400)
	}

	const periodStart = typeof body.periodStart === 'string' ? new Date(body.periodStart) : null
	const periodEnd = typeof body.periodEnd === 'string' ? new Date(body.periodEnd) : null
	if (!periodStart || Number.isNaN(periodStart.getTime())) {
		return c.json({ error: 'periodStart must be a valid ISO date string' }, 400)
	}
	if (!periodEnd || Number.isNaN(periodEnd.getTime())) {
		return c.json({ error: 'periodEnd must be a valid ISO date string' }, 400)
	}
	if (periodStart >= periodEnd) {
		return c.json({ error: 'periodStart must be before periodEnd' }, 400)
	}

	try {
		const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
		const result = await stub.rebuildFinalizedRollupsForPeriod(user.id, {
			corporationId,
			periodStart,
			periodEnd,
			// Static override: keep finalized rebuilds corporation-wallet only for now.
			includeCharacterWallets: false,
		})
		return c.json(result)
	} catch (error) {
		if (
			error instanceof Error &&
			error.message === 'Finalized rollup rebuild requires a closed period'
		) {
			return c.json({ error: error.message }, 409)
		}
		logger.error('Error rebuilding finalized tax rollups for period:', error)
		return c.json({ error: 'Failed to rebuild finalized tax rollups for period' }, 500)
	}
})

/**
 * GET /corporation-tax/corporations/:corporationId/assessments/:assessmentId/lines
 * List line items for a computed assessment.
 */
app.get(
	'/corporations/:corporationId/assessments/:assessmentId/lines',
	requireAuth(),
	async (c) => {
		const user = c.get('user')
		if (!user) {
			return c.json({ error: 'Unauthorized' }, 401)
		}

		const corporationId = c.req.param('corporationId')
		const assessmentId = c.req.param('assessmentId')
		const canManage = await canManageTaxFeature(c.env, user, corporationId)
		if (!canManage) {
			return c.json({ error: 'Forbidden' }, 403)
		}

		const limit = parseIntegerQueryParam(c.req.query('limit'))
		const offset = parseIntegerQueryParam(c.req.query('offset'))

		try {
			const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
			const lines = await stub.listAssessmentLines({
				corporationId,
				assessmentId,
				limit: limit ?? undefined,
				offset: offset ?? undefined,
			})
			return c.json(lines)
		} catch (error) {
			logger.error('Error listing tax assessment lines:', error)
			return c.json({ error: 'Failed to list tax assessment lines' }, 500)
		}
	}
)

/**
 * GET /corporation-tax/corporations/:corporationId/discrepancies
 * List tax discrepancies for a corporation.
 */
app.get('/corporations/:corporationId/discrepancies', requireAuth(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	const corporationId = c.req.param('corporationId')
	const canManage = await canManageTaxFeature(c.env, user, corporationId)
	if (!canManage) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	const assessmentId = c.req.query('assessmentId') || undefined
	const onlyOpen = parseBooleanQueryParam(c.req.query('onlyOpen'))
	const limit = parseIntegerQueryParam(c.req.query('limit'))
	const offset = parseIntegerQueryParam(c.req.query('offset'))

	try {
		const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
		const discrepancies = await stub.listDiscrepancies({
			corporationId,
			assessmentId,
			onlyOpen,
			limit: limit ?? undefined,
			offset: offset ?? undefined,
		})
		return c.json(discrepancies)
	} catch (error) {
		logger.error('Error listing tax discrepancies:', error)
		return c.json({ error: 'Failed to list tax discrepancies' }, 500)
	}
})

/**
 * POST /corporation-tax/corporations/:corporationId/ledger/ingest
 * Ingest wallet journal/transaction windows into tax ledger entries.
 */
app.post('/corporations/:corporationId/ledger/ingest', requireAuth(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	const corporationId = c.req.param('corporationId')
	const canIngest = await canManageTaxFeature(c.env, user, corporationId)
	if (!canIngest) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	let body: Record<string, unknown> = {}
	try {
		body = await c.req.json()
	} catch (_error) {
		// Optional JSON body; defaults are applied if empty/invalid.
	}

	const fromDate = typeof body.fromDate === 'string' ? new Date(body.fromDate) : undefined
	const toDate = typeof body.toDate === 'string' ? new Date(body.toDate) : undefined
	if (fromDate && Number.isNaN(fromDate.getTime())) {
		return c.json({ error: 'fromDate must be a valid ISO date string' }, 400)
	}
	if (toDate && Number.isNaN(toDate.getTime())) {
		return c.json({ error: 'toDate must be a valid ISO date string' }, 400)
	}

	try {
		const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
		const refTypes =
			Array.isArray(body.refTypes) && body.refTypes.every((value) => typeof value === 'string')
				? (body.refTypes as string[])
				: undefined
		if (refTypes && refTypes.some((value) => !isTaxIncomeRefType(value))) {
			return c.json({ error: 'refTypes must only include valid tax income ref types' }, 400)
		}
		const result = await stub.ingestCorporationLedgerWindow(user.id, corporationId, {
			includeJournal: typeof body.includeJournal === 'boolean' ? body.includeJournal : undefined,
			includeTransactions:
				typeof body.includeTransactions === 'boolean' ? body.includeTransactions : undefined,
			// Static override: ingest only corporation wallet sources for now.
			includeCharacterWallets: false,
			memberCharacterIds:
				Array.isArray(body.memberCharacterIds) &&
				body.memberCharacterIds.every((value) => typeof value === 'string')
					? (body.memberCharacterIds as string[])
					: undefined,
			maxMemberCharacters:
				typeof body.maxMemberCharacters === 'number' && Number.isInteger(body.maxMemberCharacters)
					? body.maxMemberCharacters
					: undefined,
			division:
				typeof body.division === 'number' && Number.isInteger(body.division)
					? body.division
					: undefined,
			refTypes,
			firstPartyId: typeof body.firstPartyId === 'string' ? body.firstPartyId : undefined,
			secondPartyId: typeof body.secondPartyId === 'string' ? body.secondPartyId : undefined,
			fromDate,
			toDate,
			minAmount: typeof body.minAmount === 'string' ? body.minAmount : undefined,
			maxAmount: typeof body.maxAmount === 'string' ? body.maxAmount : undefined,
			limit:
				typeof body.limit === 'number' && Number.isInteger(body.limit) ? body.limit : undefined,
			offset:
				typeof body.offset === 'number' && Number.isInteger(body.offset) ? body.offset : undefined,
		})
		return c.json(result)
	} catch (error) {
		logger.error('Error ingesting corporation tax ledger window:', error)
		return c.json({ error: 'Failed to ingest tax ledger window' }, 500)
	}
})

/**
 * GET /corporation-tax/corporations/:corporationId/ledger/entries
 * List ingested tax ledger entries.
 */
app.get('/corporations/:corporationId/ledger/entries', requireAuth(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	const corporationId = c.req.param('corporationId')
	const canManage = await canManageTaxFeature(c.env, user, corporationId)
	if (!canManage) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	const division = parseIntegerQueryParam(c.req.query('division'))
	const limit = parseIntegerQueryParam(c.req.query('limit'))
	const offset = parseIntegerQueryParam(c.req.query('offset'))
	const refTypes = c.req
		.query('refTypes')
		?.split(',')
		.map((value) => value.trim())
		.filter(Boolean)
	const sourceTypes = c.req
		.query('sourceTypes')
		?.split(',')
		.map((value) => value.trim())
		.filter(Boolean)
	const characterId = c.req.query('characterId')
	const firstPartyId = c.req.query('firstPartyId')
	const secondPartyId = c.req.query('secondPartyId')
	const fromDateQuery = c.req.query('fromDate')
	const toDateQuery = c.req.query('toDate')
	const fromDate = fromDateQuery ? new Date(fromDateQuery) : undefined
	const toDate = toDateQuery ? new Date(toDateQuery) : undefined
	if (fromDate && Number.isNaN(fromDate.getTime())) {
		return c.json({ error: 'fromDate must be a valid ISO date string' }, 400)
	}
	if (toDate && Number.isNaN(toDate.getTime())) {
		return c.json({ error: 'toDate must be a valid ISO date string' }, 400)
	}
	if (sourceTypes && sourceTypes.some((value) => !TAX_LEDGER_SOURCE_TYPES.has(value))) {
		return c.json(
			{
				error:
					'sourceTypes must only include corporation_wallet_journal, corporation_wallet_transaction, character_wallet_journal, character_wallet_transaction',
			},
			400
		)
	}
	if (refTypes && refTypes.some((value) => !isTaxIncomeRefType(value))) {
		return c.json({ error: 'refTypes must only include valid tax income ref types' }, 400)
	}

	try {
		const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
		const entries = await stub.listLedgerEntries(corporationId, {
			division: division ?? undefined,
			sourceTypes:
				sourceTypes && sourceTypes.length > 0
					? (sourceTypes as Array<
							| 'corporation_wallet_journal'
							| 'corporation_wallet_transaction'
							| 'character_wallet_journal'
							| 'character_wallet_transaction'
						>)
					: undefined,
			characterId: characterId || undefined,
			refTypes: refTypes && refTypes.length > 0 ? refTypes : undefined,
			firstPartyId: firstPartyId || undefined,
			secondPartyId: secondPartyId || undefined,
			fromDate,
			toDate,
			minAmount: c.req.query('minAmount') || undefined,
			maxAmount: c.req.query('maxAmount') || undefined,
			limit: limit ?? undefined,
			offset: offset ?? undefined,
		})
		return c.json(entries)
	} catch (error) {
		logger.error('Error listing corporation tax ledger entries:', error)
		return c.json({ error: 'Failed to list tax ledger entries' }, 500)
	}
})

/**
 * GET /corporation-tax/corporations/:corporationId/ledger/health
 * Show ingestion/checkpoint health for a corporation.
 */
app.get('/corporations/:corporationId/ledger/health', requireAuth(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	const corporationId = c.req.param('corporationId')
	const canManage = await canManageTaxFeature(c.env, user, corporationId)
	if (!canManage) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	try {
		const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
		const health = await stub.getLedgerIngestionHealth(corporationId)
		return c.json(health)
	} catch (error) {
		logger.error('Error fetching corporation tax ingestion health:', error)
		return c.json({ error: 'Failed to fetch tax ingestion health' }, 500)
	}
})

/**
 * GET /corporation-tax/corporations/:corporationId/rollups/daily
 * List daily rollups generated from ledger entries.
 */
app.get('/corporations/:corporationId/rollups/daily', requireAuth(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	const corporationId = c.req.param('corporationId')
	const canManage = await canManageTaxFeature(c.env, user, corporationId)
	if (!canManage) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	const division = parseIntegerQueryParam(c.req.query('division'))
	const limit = parseIntegerQueryParam(c.req.query('limit'))
	const offset = parseIntegerQueryParam(c.req.query('offset'))
	const refType = c.req.query('refType') || undefined
	const fromDateQuery = c.req.query('fromDate')
	const toDateQuery = c.req.query('toDate')
	const fromDate = fromDateQuery ? new Date(fromDateQuery) : undefined
	const toDate = toDateQuery ? new Date(toDateQuery) : undefined
	if (fromDate && Number.isNaN(fromDate.getTime())) {
		return c.json({ error: 'fromDate must be a valid ISO date string' }, 400)
	}
	if (toDate && Number.isNaN(toDate.getTime())) {
		return c.json({ error: 'toDate must be a valid ISO date string' }, 400)
	}
	if (refType && !isTaxIncomeRefType(refType)) {
		return c.json({ error: 'refType must be a valid tax income ref type' }, 400)
	}

	try {
		const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
		const rollups = await stub.listDailyRollups(corporationId, {
			fromDate,
			toDate,
			division: division ?? undefined,
			refType,
			limit: limit ?? undefined,
			offset: offset ?? undefined,
		})
		return c.json(rollups)
	} catch (error) {
		logger.error('Error listing corporation tax daily rollups:', error)
		return c.json({ error: 'Failed to list tax daily rollups' }, 500)
	}
})

/**
 * POST /corporation-tax/corporations/:corporationId/ledger/trim
 * Trim ledger detail rows older than the retention window.
 */
app.post('/corporations/:corporationId/ledger/trim', requireAuth(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	const corporationId = c.req.param('corporationId')
	const canTrim = await canManageTaxFeature(c.env, user, corporationId)
	if (!canTrim) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	let body: Record<string, unknown> = {}
	try {
		body = await c.req.json()
	} catch (_error) {
		// Optional payload.
	}

	const retentionDays =
		typeof body.retentionDays === 'number' && Number.isInteger(body.retentionDays)
			? body.retentionDays
			: undefined
	if (retentionDays !== undefined && (retentionDays < 1 || retentionDays > 3650)) {
		return c.json({ error: 'retentionDays must be an integer between 1 and 3650' }, 400)
	}

	try {
		const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
		const result = await stub.trimLedgerEntries(user.id, corporationId, retentionDays)
		return c.json(result)
	} catch (error) {
		logger.error('Error trimming corporation tax ledger entries:', error)
		return c.json({ error: 'Failed to trim tax ledger entries' }, 500)
	}
})

/**
 * GET /corporation-tax/corporations/:corporationId/billing-configs
 * List corporation billing configurations.
 */
app.get('/corporations/:corporationId/billing-configs', requireAuth(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	const corporationId = c.req.param('corporationId')
	const canRead = await canAuditTaxFeature(c.env, user, corporationId)
	if (!canRead) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	try {
		const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
		const rows = await stub.listCorporationBillingConfigs(corporationId)
		return c.json(rows)
	} catch (error) {
		const mapped = mapTaxBillingConfigError(
			error,
			'Failed to list corporation billing configurations'
		)
		if (mapped.status >= 500) {
			logger.error('Error listing corporation tax billing configurations:', error)
		}
		return c.json({ error: mapped.message }, mapped.status)
	}
})

/**
 * GET /corporation-tax/corporations/:corporationId/payee-characters/search?q=:query
 * Search linked characters for billing payee selection.
 */
app.get('/corporations/:corporationId/payee-characters/search', requireAuth(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	const corporationId = c.req.param('corporationId')
	const canManage = await canManageTaxFeature(c.env, user, corporationId)
	if (!canManage) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	const query = c.req.query('q')?.trim()
	if (!query || query.length < 2) {
		return c.json({ error: 'q must be at least 2 characters' }, 400)
	}

	const db = c.get('db')
	if (!db) {
		return c.json({ error: 'Database unavailable' }, 500)
	}

	const isNumeric = /^[0-9]+$/.test(query)

	try {
		const rows = await db
			.select({
				characterId: userCharacters.characterId,
				characterName: userCharacters.characterName,
			})
			.from(userCharacters)
			.where(
				isNumeric
					? or(
							eq(userCharacters.characterId, query),
							ilike(userCharacters.characterName, `%${query}%`)
						)
					: ilike(userCharacters.characterName, `%${query}%`)
			)
			.limit(25)

		return c.json(rows)
	} catch (error) {
		logger.error('Error searching billing payee characters:', error)
		return c.json({ error: 'Failed to search characters' }, 500)
	}
})

/**
 * POST /corporation-tax/corporations/:corporationId/billing-configs
 * Create one billing configuration row.
 */
app.post('/corporations/:corporationId/billing-configs', requireAuth(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	const corporationId = c.req.param('corporationId')
	const canManage = await canManageTaxFeature(c.env, user, corporationId)
	if (!canManage) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null
	if (!body) {
		return c.json({ error: 'Invalid JSON payload' }, 400)
	}

	const input = {
		isDefault: typeof body.isDefault === 'boolean' ? body.isDefault : undefined,
		billingEnabled: typeof body.billingEnabled === 'boolean' ? body.billingEnabled : undefined,
		billingIssuerUserId:
			typeof body.billingIssuerUserId === 'string' ? body.billingIssuerUserId : undefined,
		billingPayeeId: typeof body.billingPayeeId === 'string' ? body.billingPayeeId : undefined,
		billingPayeeType:
			typeof body.billingPayeeType === 'string'
				? (body.billingPayeeType as '' | 'character' | 'corporation')
				: undefined,
		billingDueDays:
			typeof body.billingDueDays === 'number' && Number.isInteger(body.billingDueDays)
				? body.billingDueDays
				: undefined,
	}
	const db = c.get('db')
	if (!db) {
		return c.json({ error: 'Database unavailable' }, 500)
	}
	const payeeValidation = await validateBillingPayeeSelection(db, input, { partial: false })
	if (!payeeValidation.ok) {
		return c.json({ error: payeeValidation.error }, 400)
	}

	try {
		const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
		const created = await stub.createCorporationBillingConfig(user.id, corporationId, input)
		return c.json(created, 201)
	} catch (error) {
		const mapped = mapTaxBillingConfigError(error, 'Failed to create billing configuration')
		if (mapped.status >= 500) {
			logger.error('Error creating corporation tax billing configuration:', error)
		}
		return c.json({ error: mapped.message }, mapped.status)
	}
})

/**
 * PATCH /corporation-tax/corporations/:corporationId/billing-configs/:configId
 * Update one billing configuration row.
 */
app.patch('/corporations/:corporationId/billing-configs/:configId', requireAuth(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	const corporationId = c.req.param('corporationId')
	const configId = c.req.param('configId')
	const canManage = await canManageTaxFeature(c.env, user, corporationId)
	if (!canManage) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null
	if (!body) {
		return c.json({ error: 'Invalid JSON payload' }, 400)
	}

	const input = {
		isDefault: typeof body.isDefault === 'boolean' ? body.isDefault : undefined,
		billingEnabled: typeof body.billingEnabled === 'boolean' ? body.billingEnabled : undefined,
		billingIssuerUserId:
			typeof body.billingIssuerUserId === 'string' ? body.billingIssuerUserId : undefined,
		billingPayeeId: typeof body.billingPayeeId === 'string' ? body.billingPayeeId : undefined,
		billingPayeeType:
			typeof body.billingPayeeType === 'string'
				? (body.billingPayeeType as '' | 'character' | 'corporation')
				: undefined,
		billingDueDays:
			typeof body.billingDueDays === 'number' && Number.isInteger(body.billingDueDays)
				? body.billingDueDays
				: undefined,
	}
	const db = c.get('db')
	if (!db) {
		return c.json({ error: 'Database unavailable' }, 500)
	}
	const payeeValidation = await validateBillingPayeeSelection(db, input, { partial: true })
	if (!payeeValidation.ok) {
		return c.json({ error: payeeValidation.error }, 400)
	}

	try {
		const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
		const updated = await stub.updateCorporationBillingConfig(
			user.id,
			corporationId,
			configId,
			input
		)
		return c.json(updated)
	} catch (error) {
		const mapped = mapTaxBillingConfigError(error, 'Failed to update billing configuration')
		if (mapped.status >= 500) {
			logger.error('Error updating corporation tax billing configuration:', error)
		}
		return c.json({ error: mapped.message }, mapped.status)
	}
})

/**
 * DELETE /corporation-tax/corporations/:corporationId/billing-configs/:configId
 * Delete one billing configuration row.
 */
app.delete('/corporations/:corporationId/billing-configs/:configId', requireAuth(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	const corporationId = c.req.param('corporationId')
	const configId = c.req.param('configId')
	const canManage = await canManageTaxFeature(c.env, user, corporationId)
	if (!canManage) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	try {
		const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
		await stub.deleteCorporationBillingConfig(user.id, corporationId, configId)
		return c.body(null, 204)
	} catch (error) {
		const mapped = mapTaxBillingConfigError(error, 'Failed to delete billing configuration')
		if (mapped.status >= 500) {
			logger.error('Error deleting corporation tax billing configuration:', error)
		}
		return c.json({ error: mapped.message }, mapped.status)
	}
})

/**
 * POST /corporation-tax/corporations/:corporationId/billing-configs/:configId/default
 * Mark one billing configuration row as default.
 */
app.post(
	'/corporations/:corporationId/billing-configs/:configId/default',
	requireAuth(),
	async (c) => {
		const user = c.get('user')
		if (!user) {
			return c.json({ error: 'Unauthorized' }, 401)
		}

		const corporationId = c.req.param('corporationId')
		const configId = c.req.param('configId')
		const canManage = await canManageTaxFeature(c.env, user, corporationId)
		if (!canManage) {
			return c.json({ error: 'Forbidden' }, 403)
		}

		try {
			const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
			const updated = await stub.setDefaultCorporationBillingConfig(
				user.id,
				corporationId,
				configId
			)
			return c.json(updated)
		} catch (error) {
			const mapped = mapTaxBillingConfigError(error, 'Failed to set default billing configuration')
			if (mapped.status >= 500) {
				logger.error('Error setting default corporation tax billing configuration:', error)
			}
			return c.json({ error: mapped.message }, mapped.status)
		}
	}
)

/**
 * POST /corporation-tax/corporations/:corporationId/assessments/:assessmentId/bills
 * Create bill for an assessment with idempotent external-source linking.
 */
app.post(
	'/corporations/:corporationId/assessments/:assessmentId/bills',
	requireAuth(),
	async (c) => {
		const user = c.get('user')
		if (!user) {
			return c.json({ error: 'Unauthorized' }, 401)
		}

		const corporationId = c.req.param('corporationId')
		const assessmentId = c.req.param('assessmentId')
		const canManage = await canManageTaxFeature(c.env, user, corporationId)
		if (!canManage) {
			return c.json({ error: 'Forbidden' }, 403)
		}

		try {
			const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
			const updated = await stub.createBillsForAssessment(user.id, corporationId, assessmentId)
			return c.json(updated)
		} catch (error) {
			const mapped = mapTaxBillingError(error, 'Failed to create bill for assessment')
			if (mapped.status >= 500) {
				logger.error('Error creating bill for tax assessment:', error)
			}
			return c.json({ error: mapped.message }, mapped.status)
		}
	}
)

/**
 * POST /corporation-tax/corporations/:corporationId/assessments/:assessmentId/bills/sync
 * Sync one assessment's bill status from bills worker.
 */
app.post(
	'/corporations/:corporationId/assessments/:assessmentId/bills/sync',
	requireAuth(),
	async (c) => {
		const user = c.get('user')
		if (!user) {
			return c.json({ error: 'Unauthorized' }, 401)
		}

		const corporationId = c.req.param('corporationId')
		const assessmentId = c.req.param('assessmentId')
		const canManage = await canManageTaxFeature(c.env, user, corporationId)
		if (!canManage) {
			return c.json({ error: 'Forbidden' }, 403)
		}

		try {
			const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
			const updated = await stub.syncAssessmentBillStatus(user.id, corporationId, assessmentId)
			return c.json(updated)
		} catch (error) {
			const mapped = mapTaxBillingError(error, 'Failed to sync assessment bill status')
			if (mapped.status >= 500) {
				logger.error('Error syncing tax assessment bill status:', error)
			}
			return c.json({ error: mapped.message }, mapped.status)
		}
	}
)

/**
 * POST /corporation-tax/corporations/:corporationId/assessments/:assessmentId/bills/retract
 * Retract (cancel) one assessment's linked bill in bills worker.
 */
app.post(
	'/corporations/:corporationId/assessments/:assessmentId/bills/retract',
	requireAuth(),
	async (c) => {
		const user = c.get('user')
		if (!user) {
			return c.json({ error: 'Unauthorized' }, 401)
		}

		const corporationId = c.req.param('corporationId')
		const assessmentId = c.req.param('assessmentId')
		const canManage = await canManageTaxFeature(c.env, user, corporationId)
		if (!canManage) {
			return c.json({ error: 'Forbidden' }, 403)
		}

		if (!corporationId || !assessmentId) {
			return c.json({ error: 'corporationId and assessmentId are required' }, 400)
		}

		try {
			const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
			const updated = await stub.retractAssessmentBill(user.id, corporationId, assessmentId)
			return c.json(updated)
		} catch (error) {
			const mapped = mapTaxBillingError(error, 'Failed to retract assessment bill')
			if (mapped.status === 500) {
				logger.error('Error retracting tax assessment bill:', error)
			}
			return c.json({ error: mapped.message }, mapped.status)
		}
	}
)

/**
 * POST /corporation-tax/corporations/:corporationId/periods/issue-bills
 * Issue bills for assessments in a period window.
 */
app.post('/corporations/:corporationId/periods/issue-bills', requireAuth(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	const corporationId = c.req.param('corporationId')
	const canIssue = await canManageTaxFeature(c.env, user, corporationId)
	if (!canIssue) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	let body: Record<string, unknown>
	try {
		body = await c.req.json()
	} catch (_error) {
		return c.json({ error: 'Invalid JSON payload' }, 400)
	}

	const periodStart = typeof body.periodStart === 'string' ? new Date(body.periodStart) : null
	const periodEnd = typeof body.periodEnd === 'string' ? new Date(body.periodEnd) : null
	if (!periodStart || Number.isNaN(periodStart.getTime())) {
		return c.json({ error: 'periodStart must be a valid ISO date string' }, 400)
	}
	if (!periodEnd || Number.isNaN(periodEnd.getTime())) {
		return c.json({ error: 'periodEnd must be a valid ISO date string' }, 400)
	}

	try {
		const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
		const result = await stub.issueBillsForPeriod(user.id, {
			corporationId,
			periodStart,
			periodEnd,
		})
		return c.json(result)
	} catch (error) {
		const mapped = mapTaxBillingError(error, 'Failed to issue bills for period')
		if (mapped.status >= 500) {
			logger.error('Error issuing bills for period:', error)
		}
		return c.json({ error: mapped.message }, mapped.status)
	}
})

/**
 * GET /corporation-tax/corporations/:corporationId/bills/history
 * Show bill status and timeline history for corporation-linked assessments.
 */
app.get('/corporations/:corporationId/bills/history', requireAuth(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	const corporationId = c.req.param('corporationId')
	const canRead = await canAuditTaxFeature(c.env, user, corporationId)
	if (!canRead) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	const limit = parseIntegerQueryParam(c.req.query('limit'))
	const offset = parseIntegerQueryParam(c.req.query('offset'))

	try {
		const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
		const history = await stub.getCorporationBillStatusHistory(corporationId, limit, offset)
		return c.json(history)
	} catch (error) {
		logger.error('Error fetching corporation tax bill history:', error)
		return c.json({ error: 'Failed to fetch corporation tax bill history' }, 500)
	}
})

/**
 * GET /corporation-tax/corporations/:corporationId/assessments/:assessmentId/bill-history
 * Show bill status and timeline history for one assessment.
 */
app.get(
	'/corporations/:corporationId/assessments/:assessmentId/bill-history',
	requireAuth(),
	async (c) => {
		const user = c.get('user')
		if (!user) {
			return c.json({ error: 'Unauthorized' }, 401)
		}

		const corporationId = c.req.param('corporationId')
		const assessmentId = c.req.param('assessmentId')
		const canRead = await canAuditTaxFeature(c.env, user, corporationId)
		if (!canRead) {
			return c.json({ error: 'Forbidden' }, 403)
		}

		try {
			const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
			const history = await stub.getAssessmentBillStatusHistory(corporationId, assessmentId)
			if (!history) {
				return c.json({ error: 'Assessment bill history not found' }, 404)
			}
			return c.json(history)
		} catch (error) {
			logger.error('Error fetching tax assessment bill history:', error)
			return c.json({ error: 'Failed to fetch tax assessment bill history' }, 500)
		}
	}
)

/**
 * POST /corporation-tax/corporations/:corporationId/bills/sync
 * Bulk-sync bill statuses for a corporation's billed assessments.
 */
app.post('/corporations/:corporationId/bills/sync', requireAuth(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	const corporationId = c.req.param('corporationId')
	const canManage = await canManageTaxFeature(c.env, user, corporationId)
	if (!canManage) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	let body: Record<string, unknown> = {}
	try {
		body = await c.req.json()
	} catch (_error) {
		// Optional JSON body; ignore parse errors for empty body.
	}

	const limit =
		typeof body.limit === 'number' && Number.isInteger(body.limit) ? body.limit : undefined
	if (limit !== undefined && (limit < 1 || limit > 250)) {
		return c.json({ error: 'limit must be an integer between 1 and 250' }, 400)
	}

	try {
		const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
		const result = await stub.syncCorporationBillStatuses(user.id, corporationId, limit)
		return c.json(result)
	} catch (error) {
		const mapped = mapTaxBillingError(error, 'Failed to sync corporation tax bill statuses')
		if (mapped.status >= 500) {
			logger.error('Error syncing corporation tax bill statuses:', error)
		}
		return c.json({ error: mapped.message }, mapped.status)
	}
})

/**
 * GET /corporation-tax/corporations/:corporationId/member-summary
 * Member-level tax summary. Without characterId, returns caller-owned member character summaries only.
 */
app.get('/corporations/:corporationId/member-summary', requireAuth(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	const corporationId = c.req.param('corporationId')
	const characterQueryRaw = (c.req.query('character') ?? c.req.query('characterId') ?? '').trim()
	const characterQuery = characterQueryRaw.length > 0 ? characterQueryRaw : undefined
	const fromDate = parseDateQueryParam(c.req.query('fromDate'))
	const toDate = parseDateQueryParam(c.req.query('toDate'))
	const topRefTypesLimit = parseIntegerQueryParam(c.req.query('topRefTypesLimit'))

	if (fromDate === null) {
		return c.json({ error: 'fromDate must be a valid ISO date string' }, 400)
	}
	if (toDate === null) {
		return c.json({ error: 'toDate must be a valid ISO date string' }, 400)
	}
	if (fromDate && toDate && fromDate > toDate) {
		return c.json({ error: 'fromDate must be before or equal to toDate' }, 400)
	}
	if (topRefTypesLimit !== undefined && topRefTypesLimit < 1) {
		return c.json({ error: 'topRefTypesLimit must be an integer greater than or equal to 1' }, 400)
	}

	const canReadWithTaxScopes = await canReadTaxFeature(c.env, user, corporationId)
	const memberCharacterIds = await getMemberCharacterIdsInCorporation(c, user, corporationId)
	const hasMemberReadAccess = memberCharacterIds.length > 0

	if (!canReadWithTaxScopes && !hasMemberReadAccess) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	try {
		const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
		let scopedCharacterIds: string[] = memberCharacterIds
		if (canReadWithTaxScopes) {
			const corpStub = getStub<EveCorporationData>(c.env.EVE_CORPORATION_DATA, corporationId)
			const members = await corpStub.getMembers(corporationId)
			scopedCharacterIds = members.map((member) => member.characterId)
		}
		const scopedCharacterIdSet = new Set(scopedCharacterIds)

		let targetCharacterIds: string[] | undefined
		if (characterQuery) {
			const numericOnly = /^\d+$/.test(characterQuery)
			if (numericOnly) {
				targetCharacterIds = scopedCharacterIdSet.has(characterQuery) ? [characterQuery] : []
			} else if (scopedCharacterIds.length > 0) {
				const matchedCharacterIds = new Set<string>()

				// Resolve name matches via ESI search and then scope to corporation members.
				// This includes members that are not linked site users.
				try {
					const tokenStoreStub = getStub<EveTokenStore>(c.env.EVE_TOKEN_STORE, 'default')
					const searchResultIds = await tokenStoreStub.searchCharacter(characterQuery, false)
					for (const characterId of searchResultIds) {
						if (scopedCharacterIdSet.has(characterId)) {
							matchedCharacterIds.add(characterId)
						}
					}
				} catch (error) {
					logger.warn('[CorporationTax] Failed ESI character search for member summary', {
						corporationId,
						characterQuery,
						error: error instanceof Error ? error.message : String(error),
					})
				}

				// Keep local fallback for linked-user rows so name-prefix search still works
				// when ESI search is unavailable in development/test paths.
				const db = c.get('db')
				if (db) {
					const rows = await db
						.select({
							characterId: userCharacters.characterId,
						})
						.from(userCharacters)
						.where(
							and(
								inArray(userCharacters.characterId, scopedCharacterIds),
								ilike(userCharacters.characterName, `${characterQuery}%`)
							)
						)
						.limit(100)
					for (const row of rows) {
						matchedCharacterIds.add(row.characterId)
					}
				}

				targetCharacterIds = Array.from(matchedCharacterIds)
			} else {
				targetCharacterIds = []
			}

			if (!canReadWithTaxScopes && targetCharacterIds.length === 0) {
				return c.json({ error: 'Forbidden' }, 403)
			}
		} else if (!canReadWithTaxScopes) {
			targetCharacterIds = memberCharacterIds
		}

		const rows = await stub.getMemberSummaryReport({
			corporationId,
			characterIds: targetCharacterIds,
			fromDate: fromDate ?? undefined,
			toDate: toDate ?? undefined,
			topRefTypesLimit: topRefTypesLimit ?? undefined,
		})
		return c.json(rows)
	} catch (error) {
		logger.error('Error fetching corporation tax member summary:', error)
		return c.json({ error: 'Failed to fetch member summary' }, 500)
	}
})

/**
 * GET /corporation-tax/reports/summary
 * Summary dashboard totals.
 */
app.get('/reports/summary', requireAuth(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	const parsed = parseReportWindowFiltersFromQuery(c.req)
	if (parsed.error) {
		return c.json({ error: parsed.error }, 400)
	}

	const canRead = await canAuditTaxFeature(c.env, user, parsed.filters?.corporationId)
	if (!canRead) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	try {
		const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
		const summary = await stub.getSummaryReport(parsed.filters)
		return c.json(summary)
	} catch (error) {
		logger.error('Error fetching corporation tax summary report:', error)
		return c.json({ error: 'Failed to fetch summary report' }, 500)
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

	const parsed = parseReportWindowFiltersFromQuery(c.req, {
		allowedSortFields: TAX_TOTAL_TAXES_SORT_FIELDS,
	})
	if (parsed.error) {
		return c.json({ error: parsed.error }, 400)
	}

	const canRead = await canAuditTaxFeature(c.env, user, parsed.filters?.corporationId)
	if (!canRead) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	try {
		const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
		const report = await stub.getTotalTaxesByCorporationReport(parsed.filters)
		return c.json(report)
	} catch (error) {
		logger.error('Error fetching total taxes by corporation report:', error)
		const isNonProd = c.env.ENVIRONMENT !== 'production'
		return c.json(
			{
				error: 'Failed to fetch total taxes by corporation report',
				...(isNonProd ? { detail: error instanceof Error ? error.message : String(error) } : {}),
			},
			500
		)
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

	const parsed = parseReportWindowFiltersFromQuery(c.req)
	if (parsed.error) {
		return c.json({ error: parsed.error }, 400)
	}

	const canRead = await canAuditTaxFeature(c.env, user, parsed.filters?.corporationId)
	if (!canRead) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	try {
		const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
		const report = await stub.getTopIncomeSourcesReport(parsed.filters)
		return c.json(report)
	} catch (error) {
		logger.error('Error fetching top income sources report:', error)
		return c.json({ error: 'Failed to fetch top income sources report' }, 500)
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

	const parsed = parseReportWindowFiltersFromQuery(c.req)
	if (parsed.error) {
		return c.json({ error: parsed.error }, 400)
	}

	const canRead = await canAuditTaxFeature(c.env, user, parsed.filters?.corporationId)
	if (!canRead) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	try {
		const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
		const report = await stub.getTopIncomeSourcesMonthlyReport(parsed.filters)
		return c.json(report)
	} catch (error) {
		logger.error('Error fetching monthly top income sources report:', error)
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

	const parsed = parseReportWindowFiltersFromQuery(c.req, {
		allowedSortFields: TAX_ESS_REPORT_SORT_FIELDS,
	})
	if (parsed.error) {
		return c.json({ error: parsed.error }, 400)
	}

	const canRead = await canAuditTaxFeature(c.env, user, parsed.filters?.corporationId)
	if (!canRead) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	try {
		const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
		const report = await stub.getEssPayoutReport(parsed.filters)
		return c.json(report)
	} catch (error) {
		logger.error('Error fetching ESS payout report:', error)
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

	const parsed = parseReportWindowFiltersFromQuery(c.req)
	if (parsed.error) {
		return c.json({ error: parsed.error }, 400)
	}

	const canRead = await canAuditTaxFeature(c.env, user, parsed.filters?.corporationId)
	if (!canRead) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	try {
		const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
		const report = await stub.getComplianceOverTimeReport(parsed.filters)
		return c.json(report)
	} catch (error) {
		logger.error('Error fetching tax compliance report:', error)
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

	const canRead = await canAuditTaxFeature(c.env, user, corporationId)
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
		logger.error('Error fetching tax discrepancy report:', error)
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
		logger.error('Error fetching missing ESI keys report:', error)
		return c.json({ error: 'Failed to fetch missing ESI keys report' }, 500)
	}
})

/**
 * GET /corporation-tax/reports/bill-status
 * Assessment bill status rollup report.
 */
app.get('/reports/bill-status', requireAuth(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	const parsed = parseReportWindowFiltersFromQuery(c.req, {
		allowedSortFields: TAX_BILL_STATUS_SORT_FIELDS,
	})
	if (parsed.error) {
		return c.json({ error: parsed.error }, 400)
	}

	const canRead = await canAuditTaxFeature(c.env, user, parsed.filters?.corporationId)
	if (!canRead) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	try {
		const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
		const report = await stub.getBillStatusReport(parsed.filters)
		return c.json(report)
	} catch (error) {
		logger.error('Error fetching corporation tax bill status report:', error)
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
	} catch (_error) {
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

	const canExport = await canAuditTaxFeature(c.env, user, corporationId)
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
		logger.error('Error requesting corporation tax export:', error)
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

	const canRead = await canAuditTaxFeature(c.env, user, corporationId)
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
		})
		return c.json(exportsList)
	} catch (error) {
		logger.error('Error listing corporation tax exports:', error)
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

		const canRead = await canAuditTaxFeature(c.env, user, record.corporationId ?? undefined)
		if (!canRead) {
			return c.json({ error: 'Forbidden' }, 403)
		}

		const artifact = await stub.getExportArtifact(exportId)
		return c.json(artifact)
	} catch (error) {
		if (error instanceof Error && error.message.includes('Export not found')) {
			return c.json({ error: 'Export not found' }, 404)
		}
		logger.error('Error fetching tax export artifact:', error)
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
	} catch (_error) {
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
	const nextRunAt = nextRunAtRaw && !Number.isNaN(nextRunAtRaw.getTime()) ? nextRunAtRaw : undefined

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
		logger.error('Error creating corporation tax export schedule:', error)
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

	if ((c.req.query('activeOnly') ?? '') !== '' && activeOnly === undefined) {
		return c.json({ error: 'activeOnly must be true/false' }, 400)
	}
	if (limit !== undefined && (limit < 1 || limit > 200)) {
		return c.json({ error: 'limit must be an integer between 1 and 200' }, 400)
	}
	if (offset !== undefined && offset < 0) {
		return c.json({ error: 'offset must be an integer >= 0' }, 400)
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
		})
		return c.json(schedules)
	} catch (error) {
		logger.error('Error listing corporation tax export schedules:', error)
		return c.json({ error: 'Failed to list export schedules' }, 500)
	}
})

/**
 * GET /corporation-tax/alerts
 * List alerts globally or scoped by corporation query parameter.
 */
app.get('/alerts', requireAuth(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	const corporationId = c.req.query('corporationId') || undefined
	const status = c.req.query('status')
	const severity = c.req.query('severity')
	const limit = parseIntegerQueryParam(c.req.query('limit'))
	const offset = parseIntegerQueryParam(c.req.query('offset'))

	if (
		status !== undefined &&
		status !== 'open' &&
		status !== 'acknowledged' &&
		status !== 'resolved'
	) {
		return c.json({ error: "status must be one of 'open', 'acknowledged', or 'resolved'" }, 400)
	}
	if (
		severity !== undefined &&
		severity !== 'critical' &&
		severity !== 'warning' &&
		severity !== 'info'
	) {
		return c.json({ error: "severity must be one of 'critical', 'warning', or 'info'" }, 400)
	}
	if (limit !== undefined && (limit < 1 || limit > 200)) {
		return c.json({ error: 'limit must be an integer between 1 and 200' }, 400)
	}
	if (offset !== undefined && offset < 0) {
		return c.json({ error: 'offset must be an integer >= 0' }, 400)
	}

	const canRead = await canManageTaxFeature(c.env, user, corporationId)
	if (!canRead) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	try {
		const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
		const alerts = await stub.listAlerts({
			corporationId,
			status: status as 'open' | 'acknowledged' | 'resolved' | undefined,
			severity: severity as 'critical' | 'warning' | 'info' | undefined,
			limit,
			offset,
		})
		return c.json(filterAlertsForUser(user, alerts))
	} catch (error) {
		logger.error('Error listing corporation tax alerts:', error)
		return c.json({ error: 'Failed to list alerts' }, 500)
	}
})

/**
 * GET /corporation-tax/corporations/:corporationId/alerts
 * Corporation-scoped alert list.
 */
app.get('/corporations/:corporationId/alerts', requireAuth(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	const corporationId = c.req.param('corporationId')
	const status = c.req.query('status')
	const severity = c.req.query('severity')
	const limit = parseIntegerQueryParam(c.req.query('limit'))
	const offset = parseIntegerQueryParam(c.req.query('offset'))

	if (
		status !== undefined &&
		status !== 'open' &&
		status !== 'acknowledged' &&
		status !== 'resolved'
	) {
		return c.json({ error: "status must be one of 'open', 'acknowledged', or 'resolved'" }, 400)
	}
	if (
		severity !== undefined &&
		severity !== 'critical' &&
		severity !== 'warning' &&
		severity !== 'info'
	) {
		return c.json({ error: "severity must be one of 'critical', 'warning', or 'info'" }, 400)
	}
	if (limit !== undefined && (limit < 1 || limit > 200)) {
		return c.json({ error: 'limit must be an integer between 1 and 200' }, 400)
	}
	if (offset !== undefined && offset < 0) {
		return c.json({ error: 'offset must be an integer >= 0' }, 400)
	}

	const canRead = await canManageTaxFeature(c.env, user, corporationId)
	if (!canRead) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	try {
		const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
		const alerts = await stub.listAlerts({
			corporationId,
			status: status as 'open' | 'acknowledged' | 'resolved' | undefined,
			severity: severity as 'critical' | 'warning' | 'info' | undefined,
			limit,
			offset,
		})
		return c.json(filterAlertsForUser(user, alerts))
	} catch (error) {
		logger.error('Error listing corporation-scoped tax alerts:', error)
		return c.json({ error: 'Failed to list corporation alerts' }, 500)
	}
})

/**
 * POST /corporation-tax/alerts/:alertId/acknowledge
 * Acknowledge alert (auditor/admin).
 */
app.post('/alerts/:alertId/acknowledge', requireAuth(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	const canAcknowledge = await canManageTaxFeature(c.env, user)
	if (!canAcknowledge) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	try {
		const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
		const updated = await stub.acknowledgeAlert(user.id, c.req.param('alertId'))
		return c.json(updated)
	} catch (error) {
		if (error instanceof Error && error.message === 'Alert not found') {
			return c.json({ error: 'Alert not found' }, 404)
		}
		logger.error('Error acknowledging tax alert:', error)
		return c.json({ error: 'Failed to acknowledge alert' }, 500)
	}
})

/**
 * POST /corporation-tax/alerts/:alertId/resolve
 * Resolve alert (admin).
 */
app.post('/alerts/:alertId/resolve', requireAuth(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	const canResolve = await canManageTaxFeature(c.env, user)
	if (!canResolve) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	try {
		const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
		const updated = await stub.resolveAlert(user.id, c.req.param('alertId'))
		return c.json(updated)
	} catch (error) {
		if (error instanceof Error && error.message === 'Alert not found') {
			return c.json({ error: 'Alert not found' }, 404)
		}
		logger.error('Error resolving tax alert:', error)
		return c.json({ error: 'Failed to resolve alert' }, 500)
	}
})

/**
 * POST /corporation-tax/alerts/retry-failed-deliveries
 * Retry failed Discord worker invocation deliveries.
 */
app.post('/alerts/retry-failed-deliveries', requireAuth(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	if (!user.is_admin) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	let body: Record<string, unknown> = {}
	try {
		body = await c.req.json()
	} catch (_error) {
		// optional body
	}
	const limit =
		typeof body.limit === 'number' && Number.isInteger(body.limit) ? body.limit : undefined
	if (limit !== undefined && (limit < 1 || limit > 100)) {
		return c.json({ error: 'limit must be an integer between 1 and 100' }, 400)
	}

	try {
		const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
		const retried = await stub.retryFailedAlertDeliveries(user.id, limit)
		return c.json({ retried })
	} catch (error) {
		logger.error('Error retrying failed tax alert deliveries:', error)
		return c.json({ error: 'Failed to retry alert deliveries' }, 500)
	}
})

/**
 * PUT /corporation-tax/notification-destinations
 * Upsert Discord notification destination.
 */
app.put('/notification-destinations', requireAuth(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	let body: Record<string, unknown>
	try {
		body = await c.req.json()
	} catch (_error) {
		return c.json({ error: 'Invalid JSON payload' }, 400)
	}

	const scope = typeof body.scope === 'string' ? body.scope : ''
	const corporationId = typeof body.corporationId === 'string' ? body.corporationId : undefined
	const guildId = typeof body.guildId === 'string' ? body.guildId : ''
	const channelId = typeof body.channelId === 'string' ? body.channelId : ''
	const isActive = typeof body.isActive === 'boolean' ? body.isActive : undefined

	if (scope !== 'global' && scope !== 'corporation') {
		return c.json({ error: "scope must be 'global' or 'corporation'" }, 400)
	}
	if (scope === 'corporation' && !corporationId) {
		return c.json({ error: 'corporationId is required for corporation scope' }, 400)
	}
	if (scope === 'global' && corporationId) {
		return c.json({ error: 'corporationId must be omitted for global scope' }, 400)
	}
	if (!guildId || !channelId) {
		return c.json({ error: 'guildId and channelId are required' }, 400)
	}

	const destinationValidationError = await validateDiscordDestinationInput(c, guildId, channelId)
	if (destinationValidationError) {
		return c.json({ error: destinationValidationError }, 400)
	}

	const canManage = await canManageTaxFeature(c.env, user, corporationId)
	if (!canManage) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	try {
		const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
		const destination = await stub.upsertNotificationDestination(user.id, {
			scope: scope as 'global' | 'corporation',
			corporationId: corporationId ?? null,
			guildId,
			channelId,
			isActive,
		})
		return c.json(destination)
	} catch (error) {
		if (
			error instanceof Error &&
			(error.message.includes('corporationId is required') ||
				error.message.includes('corporationId must be null'))
		) {
			return c.json({ error: error.message }, 400)
		}
		logger.error('Error upserting tax notification destination:', error)
		return c.json({ error: 'Failed to upsert notification destination' }, 500)
	}
})

/**
 * GET /corporation-tax/notification-destinations
 * List Discord notification destinations.
 */
app.get('/notification-destinations', requireAuth(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	const scope = c.req.query('scope')
	const corporationId = c.req.query('corporationId') || undefined
	const limit = parseIntegerQueryParam(c.req.query('limit'))
	const offset = parseIntegerQueryParam(c.req.query('offset'))

	if (scope !== undefined && scope !== 'global' && scope !== 'corporation') {
		return c.json({ error: "scope must be 'global' or 'corporation'" }, 400)
	}
	if (limit !== undefined && (limit < 1 || limit > 200)) {
		return c.json({ error: 'limit must be an integer between 1 and 200' }, 400)
	}
	if (offset !== undefined && offset < 0) {
		return c.json({ error: 'offset must be an integer >= 0' }, 400)
	}

	const canRead = await canManageTaxFeature(c.env, user, corporationId)
	if (!canRead) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	try {
		const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
		const destinations = await stub.listNotificationDestinations({
			scope: scope as 'global' | 'corporation' | undefined,
			corporationId,
			limit,
			offset,
		})
		return c.json(destinations)
	} catch (error) {
		logger.error('Error listing tax notification destinations:', error)
		return c.json({ error: 'Failed to list notification destinations' }, 500)
	}
})

/**
 * GET /corporation-tax/audit-log
 * List tax audit log records.
 */
app.get('/audit-log', requireAuth(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	const parsed = parseAuditLogFiltersFromQuery(c.req)
	if (parsed.error) {
		return c.json({ error: parsed.error }, 400)
	}

	const filters = parsed.filters ?? {}
	const canRead = await canManageTaxFeature(c.env, user, filters.corporationId)
	if (!canRead) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	try {
		const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
		const entries = await stub.listAuditLog(filters)
		return c.json(entries)
	} catch (error) {
		logger.error('Error listing tax audit log:', error)
		return c.json({ error: 'Failed to list tax audit log' }, 500)
	}
})

export default app
