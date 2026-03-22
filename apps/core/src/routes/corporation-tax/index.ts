import { Hono } from 'hono'

import { isTaxIncomeRefType } from '@repo/corporation-tax'
import { and, desc, eq, ilike, inArray, or } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'
import { logger, TimeCache } from '@repo/hono-helpers'

import { discordServers, managedCorporations, userCharacters } from '../../db/schema'
import { requireAuth } from '../../middleware/session'
import {
	canAuditTaxFeature,
	canManageTaxFeature,
	canReadTaxFeature,
	getTaxCharacterIds,
} from '../../middleware/tax-permissions'
import { registerCorporationTaxAlertsRoutes } from './alerts-routes'
import { registerCorporationTaxReportsRoutes } from './reports-routes'
import {
	mapTaxBillingConfigError,
	mapTaxBillingError,
	parseBooleanQueryParam,
	parseDateQueryParam,
	parseIntegerQueryParam,
	SNOWFLAKE_REGEX,
	TAX_FEATURE_FLAG_KEY,
	TAX_LEDGER_SOURCE_TYPES,
	TAX_RULE_PRIORITY_MAX,
	TAX_RULE_PRIORITY_MIN,
} from './shared'

import type { CorporationTax } from '@repo/corporation-tax'
import type { EveCharacterData } from '@repo/eve-character-data'
import type { EveCorporationData } from '@repo/eve-corporation-data'
import type { EveTokenStore } from '@repo/eve-token-store'
import type { Features } from '@repo/features'
import type { App, SessionUser } from '../../context'

const app = new Hono<App>()
const corpMembershipCache = new TimeCache<string[]>(60_000)
const ledgerPartiesCache = new TimeCache<
	Array<{
		entityId: string
		entityName: string | null
		senderCount: number
		recipientCount: number
		lastSeenAt: Date
	}>
>(60_000)

function normalizeLedgerPartySearchText(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim()
}

function isSubsequenceMatch(haystack: string, needle: string): boolean {
	if (!haystack || !needle) {
		return false
	}
	let cursor = 0
	for (const char of haystack) {
		if (char === needle[cursor]) {
			cursor += 1
			if (cursor === needle.length) {
				return true
			}
		}
	}
	return false
}

function rankLedgerPartyMatch(entityId: string, entityName: string | null, query: string): number {
	const normalizedQuery = normalizeLedgerPartySearchText(query)
	if (!normalizedQuery) {
		return 1
	}

	const normalizedId = normalizeLedgerPartySearchText(entityId)
	const normalizedName = normalizeLedgerPartySearchText(entityName ?? '')

	if (normalizedId === normalizedQuery || normalizedName === normalizedQuery) {
		return 120
	}
	if (
		normalizedId.startsWith(normalizedQuery) ||
		normalizedName.startsWith(normalizedQuery) ||
		normalizedName.split(' ').some((segment) => segment.startsWith(normalizedQuery))
	) {
		return 100
	}
	if (normalizedId.includes(normalizedQuery) || normalizedName.includes(normalizedQuery)) {
		return 70
	}
	if (
		normalizedQuery.length >= 2 &&
		(isSubsequenceMatch(normalizedId, normalizedQuery) ||
			isSubsequenceMatch(normalizedName.replace(/ /g, ''), normalizedQuery.replace(/ /g, '')))
	) {
		return 40
	}

	return 0
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

async function validateBillingPayeeSelection(
	db: App['Variables']['db'],
	input: {
		billingPayeeId?: string
		billingPayeeType?: 'character' | 'corporation'
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
			where: and(
				eq(userCharacters.characterId, payeeId),
				eq(userCharacters.status, 'active'),
				eq(userCharacters.isDeleted, false)
			),
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
	if (limit !== undefined && (limit < 1 || limit > 1000)) {
		return c.json({ error: 'limit must be between 1 and 1000' }, 400)
	}
	if (offset !== undefined && offset < 0) {
		return c.json({ error: 'offset must be >= 0' }, 400)
	}

	try {
		const db = c.get('db')
		if (!db) {
			return c.json({ error: 'Database unavailable' }, 500)
		}

		const boundedLimit = Math.min(Math.max(limit ?? 200, 1), 1000)
		const boundedOffset = Math.max(offset ?? 0, 0)
		const managedCorps = await db.query.managedCorporations.findMany({
			where: and(
				eq(managedCorporations.isActive, true),
				eq(managedCorporations.isMemberCorporation, true)
			),
			orderBy: [desc(managedCorporations.updatedAt)],
			limit: boundedLimit,
			offset: boundedOffset,
		})

		const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
		const exclusionMap = new Map<string, string | null>()
		let exclusionOffset = 0
		const exclusionPageSize = 500
		while (true) {
			const page = await stub.listCorporationExclusions({
				limit: exclusionPageSize,
				offset: exclusionOffset,
			})
			for (const row of page) {
				exclusionMap.set(row.corporationId, row.reason ?? null)
			}
			if (page.length < exclusionPageSize) {
				break
			}
			exclusionOffset += page.length
		}

		const rows = managedCorps.map((corp) => ({
			corporationId: corp.corporationId,
			included: !exclusionMap.has(corp.corporationId),
			exclusionReason: exclusionMap.get(corp.corporationId) ?? null,
			createdAt: corp.createdAt,
			updatedAt: corp.updatedAt,
		}))
		return c.json(rows)
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
	const canRead = await canAuditTaxFeature(c.env, user, corporationId)
	if (!canRead) {
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
	const canRead = await canAuditTaxFeature(c.env, user, corporationId)
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
	const canRead = await canAuditTaxFeature(c.env, user, corporationId)
	if (!canRead) {
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

	if (body.priority !== undefined) {
		if (
			typeof body.priority !== 'number' ||
			!Number.isInteger(body.priority) ||
			body.priority < TAX_RULE_PRIORITY_MIN ||
			body.priority > TAX_RULE_PRIORITY_MAX
		) {
			return c.json(
				{
					error: `priority must be an integer between ${TAX_RULE_PRIORITY_MIN} and ${TAX_RULE_PRIORITY_MAX}`,
				},
				400
			)
		}
	}
	const priority = typeof body.priority === 'number' ? body.priority : 0
	const isActive = typeof body.isActive === 'boolean' ? body.isActive : true
	const taxRateBps =
		typeof body.taxRateBps === 'number' && Number.isInteger(body.taxRateBps) ? body.taxRateBps : -1
	if (taxRateBps < 0 || taxRateBps > 10_000) {
		return c.json({ error: 'taxRateBps must be an integer between 0 and 10000' }, 400)
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
			appliesToRefType,
			taxRateBps,
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
	try {
		const appliesToRefTypeRaw =
			typeof body.appliesToRefType === 'string' ? body.appliesToRefType.trim() : undefined
		const appliesToRefType = appliesToRefTypeRaw || undefined
		if (appliesToRefType && !isTaxIncomeRefType(appliesToRefType)) {
			return c.json({ error: 'appliesToRefType must be a valid tax income ref type' }, 400)
		}
		const hasPriority = Object.prototype.hasOwnProperty.call(body, 'priority')
		let priority: number | undefined
		if (hasPriority) {
			if (
				typeof body.priority !== 'number' ||
				!Number.isInteger(body.priority) ||
				body.priority < TAX_RULE_PRIORITY_MIN ||
				body.priority > TAX_RULE_PRIORITY_MAX
			) {
				return c.json(
					{
						error: `priority must be an integer between ${TAX_RULE_PRIORITY_MIN} and ${TAX_RULE_PRIORITY_MAX}`,
					},
					400
				)
			}
			priority = body.priority
		}

		const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
		const updated = await stub.updateRuleSet(user.id, ruleSetId, {
			isActive: typeof body.isActive === 'boolean' ? body.isActive : undefined,
			name: typeof body.name === 'string' ? body.name : undefined,
			priority,
			appliesToRefType,
			taxRateBps:
				typeof body.taxRateBps === 'number' && Number.isInteger(body.taxRateBps)
					? body.taxRateBps
					: undefined,
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
 * GET /corporation-tax/corporations/:corporationId/ledger/parties
 * List distinct sender/recipient entities for ledger filtering, with resolved names.
 */
app.get('/corporations/:corporationId/ledger/parties', requireAuth(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	const corporationId = c.req.param('corporationId')
	const canManage = await canManageTaxFeature(c.env, user, corporationId)
	if (!canManage) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	const limit = parseIntegerQueryParam(c.req.query('limit'))
	const query = c.req.query('q')?.trim() ?? ''
	const directionQuery = c.req.query('direction')?.trim().toLowerCase()
	const direction: 'any' | 'sender' | 'recipient' =
		directionQuery === 'sender' || directionQuery === 'recipient' ? directionQuery : 'any'
	const fromDate = parseDateQueryParam(c.req.query('fromDate'))
	const toDate = parseDateQueryParam(c.req.query('toDate'))
	if (fromDate === null) {
		return c.json({ error: 'fromDate must be a valid ISO date string' }, 400)
	}
	if (toDate === null) {
		return c.json({ error: 'toDate must be a valid ISO date string' }, 400)
	}
	if (fromDate && toDate && fromDate > toDate) {
		return c.json({ error: 'fromDate must be before or equal to toDate' }, 400)
	}
	if (limit !== undefined && (limit < 1 || limit > 2000)) {
		return c.json({ error: 'limit must be an integer between 1 and 2000' }, 400)
	}
	if (
		directionQuery !== undefined &&
		directionQuery !== 'any' &&
		directionQuery !== 'sender' &&
		directionQuery !== 'recipient'
	) {
		return c.json({ error: "direction must be one of: 'any', 'sender', 'recipient'" }, 400)
	}

	const requestedLimit = limit ?? 100
	const fetchLimit = 2000

	try {
		const cacheKey = `${corporationId}:${fromDate?.toISOString() ?? 'none'}:${toDate?.toISOString() ?? 'none'}`
		const hydratedRows = await ledgerPartiesCache.getOrSet(cacheKey, async () => {
			const stub = getStub<CorporationTax>(c.env.CORPORATION_TAX, 'default')
			const rows = await stub.listLedgerParties(corporationId, {
				fromDate: fromDate ?? undefined,
				toDate: toDate ?? undefined,
				limit: fetchLimit,
			})

			const entityIds = rows.map((row) => row.entityId)
			let resolvedNames: Record<string, string> = {}
			if (entityIds.length > 0) {
				try {
					const tokenStoreStub = getStub<EveTokenStore>(c.env.EVE_TOKEN_STORE, 'default')
					resolvedNames = await tokenStoreStub.resolveIds(entityIds)
				} catch (error) {
					logger.warn('[CorporationTax] Failed to resolve ledger party entity names', {
						corporationId,
						error: error instanceof Error ? error.message : String(error),
					})
				}
			}

			return rows.map((row) => ({
				entityId: row.entityId,
				entityName: resolvedNames[row.entityId] ?? null,
				senderCount: row.senderCount,
				recipientCount: row.recipientCount,
				lastSeenAt: row.lastSeenAt,
			}))
		})
		const directionRows =
			direction === 'sender'
				? hydratedRows.filter((row) => row.senderCount > 0)
				: direction === 'recipient'
					? hydratedRows.filter((row) => row.recipientCount > 0)
					: hydratedRows
		const responseRows = query
			? directionRows
					.map((row) => ({
						...row,
						matchScore: rankLedgerPartyMatch(row.entityId, row.entityName, query),
					}))
					.filter((row) => row.matchScore > 0)
					.sort((left, right) => {
						if (right.matchScore !== left.matchScore) {
							return right.matchScore - left.matchScore
						}
						if (right.lastSeenAt.getTime() !== left.lastSeenAt.getTime()) {
							return right.lastSeenAt.getTime() - left.lastSeenAt.getTime()
						}
						return (
							right.senderCount + right.recipientCount - (left.senderCount + left.recipientCount)
						)
					})
					.slice(0, requestedLimit)
					.map(({ matchScore: _matchScore, ...row }) => row)
			: directionRows.slice(0, requestedLimit)

		return c.json(
			responseRows.map((row) => ({
				entityId: row.entityId,
				entityName: row.entityName,
				lastSeenAt: row.lastSeenAt,
			}))
		)
	} catch (error) {
		logger.error('Error listing corporation tax ledger parties:', error)
		return c.json({ error: 'Failed to list tax ledger parties' }, 500)
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
				and(
					isNumeric
						? or(
								eq(userCharacters.characterId, query),
								ilike(userCharacters.characterName, `%${query}%`)
							)
						: ilike(userCharacters.characterName, `%${query}%`),
					eq(userCharacters.status, 'active'),
					eq(userCharacters.isDeleted, false)
				)
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
				? (body.billingPayeeType as 'character' | 'corporation')
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
				? (body.billingPayeeType as 'character' | 'corporation')
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
 * GET /corporation-tax/corporations/:corporationId/bills/history/events
 * Show paged billing-domain events for corporation-linked assessments.
 */
app.get('/corporations/:corporationId/bills/history/events', requireAuth(), async (c) => {
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
		const history = await stub.getCorporationBillEventHistory(corporationId, limit, offset)
		return c.json(history)
	} catch (error) {
		logger.error('Error fetching corporation tax bill event history:', error)
		return c.json({ error: 'Failed to fetch corporation tax bill event history' }, 500)
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
registerCorporationTaxReportsRoutes(app)
registerCorporationTaxAlertsRoutes(app, { validateDiscordDestinationInput })

export default app
