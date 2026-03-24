/**
 * Bills routes - Administrative operations for managing bills, templates, and schedules
 *
 * All endpoints require authentication and admin privileges.
 * These endpoints call the Bills Durable Object via RPC.
 */

import { and, eq, ilike, inArray, or } from 'drizzle-orm'
import { Hono } from 'hono'

import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

import { createDb } from '../db'
import { managedCorporations, userCharacters, users } from '../db/schema'
import { validatePagination } from '../lib/validation'
import { requireAdmin, requireAuth } from '../middleware/session'

import type {
	BillFilters,
	BillListSortDirection,
	BillListSortField,
	BillPartyDirection,
	Bills,
	EntitySearchType,
	EntityType,
} from '@repo/bills'
import type { EsiTypeResolver } from '@repo/esi'
import type { Groups } from '@repo/groups'
import type { App } from '../context'

const app = new Hono<App>()
const BILL_SORT_FIELDS = new Set<BillListSortField>([
	'createdAt',
	'updatedAt',
	'dueDate',
	'amount',
	'status',
])
const ENTITY_TYPES = new Set<EntityType>(['character', 'corporation', 'group'])
const PAYEE_ENTITY_TYPES = new Set<EntityType>(['character', 'corporation'])
const ENTITY_SEARCH_TYPES = new Set<EntitySearchType>(['character', 'corporation', 'group', 'user'])

async function resolveGroupNames(
	c: App['Bindings'],
	groupIds: string[]
): Promise<Map<string, string>> {
	const names = new Map<string, string>()
	const normalizedIds = [...new Set(groupIds.map((id) => id.trim()).filter(Boolean))]
	if (normalizedIds.length === 0) {
		return names
	}

	const groupsStub = getStub<Groups>(c.GROUPS, 'default')
	const groups = await groupsStub.getGroupMetadataByIds(normalizedIds)
	for (const group of groups) {
		names.set(group.id, group.name)
	}

	return names
}

function parseBillFilters(c: { req: { query: (key: string) => string | undefined } }): BillFilters {
	const status = c.req.query('status')
	const payerId = c.req.query('payerId')?.trim()
	const payeeId = c.req.query('payeeId')?.trim()
	const issuerId = c.req.query('issuerId')?.trim()
	const payerType = c.req.query('payerType')?.trim()
	const payeeType = c.req.query('payeeType')?.trim()
	const dueAfter = c.req.query('dueAfter')
	const dueBefore = c.req.query('dueBefore')
	const createdAfter = c.req.query('createdAfter')
	const createdBefore = c.req.query('createdBefore')
	const filters: BillFilters = {}
	if (status) filters.status = status as BillFilters['status']
	if (payerId) filters.payerId = payerId
	if (payeeId) filters.payeeId = payeeId
	if (issuerId) filters.issuerId = issuerId
	if (payerType && ENTITY_TYPES.has(payerType as EntityType)) {
		filters.payerType = payerType as EntityType
	}
	if (payeeType && PAYEE_ENTITY_TYPES.has(payeeType as EntityType)) {
		filters.payeeType = payeeType as EntityType
	}
	if (dueAfter) filters.dueAfter = new Date(dueAfter)
	if (dueBefore) filters.dueBefore = new Date(dueBefore)
	if (createdAfter) filters.createdAfter = new Date(createdAfter)
	if (createdBefore) filters.createdBefore = new Date(createdBefore)
	return filters
}

// ===== Bill Routes =====
// IMPORTANT: Specific routes (like /templates, /statistics) must be defined
// BEFORE parameterized routes (like /:billId) to prevent incorrect matching

/**
 * GET /bills
 * List bills with optional filters
 */
app.get('/', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		// Validate pagination parameters
		const pagination = validatePagination(c.req.query('limit'), c.req.query('offset'))
		if (!pagination.success) {
			return c.json({ error: pagination.error }, pagination.status)
		}

		const filters = parseBillFilters(c)
		const sortByQuery = c.req.query('sortBy')?.trim() as BillListSortField | undefined
		const sortDirQuery = c.req.query('sortDir')?.trim() as BillListSortDirection | undefined
		const sortBy = sortByQuery && BILL_SORT_FIELDS.has(sortByQuery) ? sortByQuery : 'dueDate'
		const sortDir: BillListSortDirection = sortDirQuery === 'desc' ? 'desc' : 'asc'

		logger.info('[bills-admin] Fetching bills', {
			userId: user.id,
			filters,
			limit: pagination.data.limit,
			offset: pagination.data.offset,
			sortBy,
			sortDir,
		})

		const stub = getStub<Bills>(c.env.BILLS, 'default')
		const page = await stub.listBillsPage({
			scope: { mode: 'all' },
			filters,
			limit: pagination.data.limit,
			offset: pagination.data.offset,
			sortBy,
			sortDir,
		})
		const db = createDb(c.env.DATABASE_URL)
		const issuerIds = [...new Set(page.rows.map((row) => row.issuerId).filter(Boolean))]
		const payerAndPayeeEsiIds = [
			...new Set(
				page.rows.flatMap((row) =>
					[row.payerType !== 'group' ? row.payerId : null, row.payeeId].filter(Boolean)
				)
			),
		] as string[]
		const groupIds = [
			...new Set(
				page.rows.flatMap((row) => [row.payerType === 'group' ? row.payerId : null].filter(Boolean))
			),
		] as string[]
		const issuerUsers =
			issuerIds.length > 0
				? await db.query.users.findMany({
						where: inArray(users.id, issuerIds),
						columns: { id: true, mainCharacterId: true },
					})
				: []
		const issuerMainCharacterByUserId = new Map(
			issuerUsers
				.map((issuerUser) => [issuerUser.id, issuerUser.mainCharacterId] as const)
				.filter((row): row is readonly [string, string] => Boolean(row[1]))
		)
		const resolverIds = [
			...new Set([
				...payerAndPayeeEsiIds,
				...issuerUsers.map((issuerUser) => issuerUser.mainCharacterId).filter(Boolean),
			]),
		] as string[]
		const resolver = getStub<EsiTypeResolver>(c.env.ESI_TYPE_RESOLVER, 'global')
		const names = resolverIds.length > 0 ? await resolver.resolveIds(resolverIds) : {}
		const groupNames = await resolveGroupNames(c.env, groupIds)
		const rows = page.rows.map((row) => {
			const issuerMainCharacterId = issuerMainCharacterByUserId.get(row.issuerId)
			return {
				...row,
				payerName:
					row.payerType === 'group'
						? (groupNames.get(row.payerId) ?? row.payerName)
						: (names[row.payerId] ?? row.payerName),
				payeeName: row.payeeId ? (names[row.payeeId] ?? row.payeeName) : row.payeeName,
				issuerName: issuerMainCharacterId
					? (names[issuerMainCharacterId] ?? row.issuerName)
					: row.issuerName,
			}
		})

		logger.info('[bills-admin] Bills fetched successfully', {
			count: rows.length,
			rowCount: page.rowCount,
			userId: user.id,
		})
		return c.json({ rows, rowCount: page.rowCount })
	} catch (error) {
		const cause = (error as { cause?: unknown })?.cause as
			| { message?: string; code?: string; detail?: string; hint?: string }
			| undefined
		logger.error('[bills-admin] Error listing bills:', {
			error: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : undefined,
			causeMessage: cause?.message,
			causeCode: cause?.code,
			causeDetail: cause?.detail,
			causeHint: cause?.hint,
		})
		return c.json({ error: 'Failed to list bills' }, 500)
	}
})

app.get('/parties/search', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}
	try {
		const q = c.req.query('q')?.trim() ?? ''
		const requestedLimit = Number(c.req.query('limit') ?? '25')
		const limit = Number.isFinite(requestedLimit)
			? Math.max(1, Math.min(100, Math.floor(requestedLimit)))
			: 25
		const directionQuery = c.req.query('direction')?.trim()
		const direction: BillPartyDirection =
			directionQuery === 'payer' || directionQuery === 'payee' ? directionQuery : 'any'
		const entityTypeQuery = c.req.query('entityType')?.trim()
		const entityType =
			entityTypeQuery && ENTITY_TYPES.has(entityTypeQuery as EntityType)
				? (entityTypeQuery as EntityType)
				: undefined
		const stub = getStub<Bills>(c.env.BILLS, 'default')
		const rows = await stub.searchBillParties({
			scope: { mode: 'all' },
			direction,
			entityType,
			q: /^\d+$/.test(q) ? q : undefined,
			limit: Math.max(limit, 200),
		})
		const resolver = getStub<EsiTypeResolver>(c.env.ESI_TYPE_RESOLVER, 'global')
		const esiIds = [
			...new Set(rows.filter((row) => row.entityType !== 'group').map((row) => row.entityId)),
		]
		const groupIds = [
			...new Set(rows.filter((row) => row.entityType === 'group').map((row) => row.entityId)),
		]
		const names = esiIds.length > 0 ? await resolver.resolveIds(esiIds) : {}
		const groupNames = await resolveGroupNames(c.env, groupIds)
		const normalizedQ = q.toLowerCase()
		const filteredRows = q
			? rows.filter((row) => {
					const resolvedName =
						row.entityType === 'group' ? groupNames.get(row.entityId) : names[row.entityId]
					const name = (resolvedName || '').toLowerCase()
					return row.entityId === q || name.includes(normalizedQ)
				})
			: rows
		const deduped = new Map<
			string,
			{ entityId: string; entityType: EntityType; usageCount: number; name: string | null }
		>()
		for (const row of filteredRows) {
			const key = row.entityId
			if (deduped.has(key)) continue
			deduped.set(key, {
				entityId: row.entityId,
				entityType: row.entityType,
				usageCount: row.usageCount,
				name:
					(row.entityType === 'group' ? groupNames.get(row.entityId) : names[row.entityId]) ?? null,
			})
		}
		return c.json([...deduped.values()].slice(0, limit))
	} catch (error) {
		logger.error('[bills-admin] Error searching parties:', error)
		return c.json({ error: 'Failed to search bill parties' }, 500)
	}
})

app.get('/entities/search', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}
	try {
		const q = c.req.query('q')?.trim() ?? ''
		if (q.length < 2) {
			return c.json([])
		}
		const requestedLimit = Number(c.req.query('limit') ?? '25')
		const limit = Number.isFinite(requestedLimit)
			? Math.max(1, Math.min(100, Math.floor(requestedLimit)))
			: 25
		const entityTypeQuery = c.req.query('entityType')?.trim()
		const entityType =
			entityTypeQuery && ENTITY_SEARCH_TYPES.has(entityTypeQuery as EntitySearchType)
				? (entityTypeQuery as EntitySearchType)
				: undefined
		if (!entityType) {
			return c.json({ error: 'entityType is required' }, 400)
		}
		const db = createDb(c.env.DATABASE_URL)
		const numericQuery = /^\d+$/.test(q)

		if (entityType === 'corporation') {
			const rows = await db.query.managedCorporations.findMany({
				where: and(
					eq(managedCorporations.isActive, true),
					or(
						ilike(managedCorporations.name, `${q}%`),
						numericQuery ? eq(managedCorporations.corporationId, q) : undefined
					)
				),
				orderBy: (table, { asc }) => [asc(table.name)],
				limit,
			})
			const deduped = new Map<
				string,
				{ entityId: string; entityType: EntityType; name: string | null }
			>()
			for (const row of rows) {
				const key = `${entityType}:${row.corporationId}`
				if (!deduped.has(key)) {
					deduped.set(key, {
						entityId: row.corporationId,
						entityType,
						name: row.name,
					})
				}
			}
			return c.json([...deduped.values()].slice(0, limit))
		}

		if (entityType === 'character') {
			const rows = await db.query.userCharacters.findMany({
				where: and(
					eq(userCharacters.isDeleted, false),
					eq(userCharacters.status, 'active'),
					or(
						ilike(userCharacters.characterName, `${q}%`),
						numericQuery ? eq(userCharacters.characterId, q) : undefined
					)
				),
				orderBy: (table, { asc }) => [asc(table.characterName)],
				limit,
			})
			const deduped = new Map<
				string,
				{ entityId: string; entityType: EntityType; name: string | null }
			>()
			for (const row of rows) {
				const key = `${entityType}:${row.characterId}`
				const existing = deduped.get(key)
				if (!existing) {
					deduped.set(key, {
						entityId: row.characterId,
						entityType,
						name: row.characterName ?? null,
					})
					continue
				}
				if (!existing.name && row.characterName) {
					deduped.set(key, {
						entityId: row.characterId,
						entityType,
						name: row.characterName,
					})
				}
			}
			return c.json([...deduped.values()].slice(0, limit))
		}

		if (entityType === 'group') {
			const groupsStub = getStub<Groups>(c.env.GROUPS, 'default')
			const rows = await groupsStub.listGroups(
				{
					search: q,
					limit,
					offset: 0,
				},
				user.id,
				true
			)
			const deduped = new Map<
				string,
				{ entityId: string; entityType: EntitySearchType; name: string | null }
			>()
			for (const row of rows) {
				const key = `${entityType}:${row.id}`
				if (!deduped.has(key)) {
					deduped.set(key, {
						entityId: row.id,
						entityType,
						name: row.name,
					})
				}
			}
			const isUuidQuery =
				/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(q)
			if (isUuidQuery) {
				try {
					const exact = await groupsStub.getGroup(q, user.id, true)
					if (exact) {
						const key = `${entityType}:${exact.id}`
						if (!deduped.has(key)) {
							deduped.set(key, {
								entityId: exact.id,
								entityType,
								name: exact.name,
							})
						}
					}
				} catch {
					// Best-effort exact lookup only.
				}
			}
			return c.json([...deduped.values()].slice(0, limit))
		}

		if (entityType === 'user') {
			const usersById = await db.query.users.findMany({
				where: ilike(users.id, `${q}%`),
				columns: { id: true, mainCharacterId: true },
				limit,
			})
			const usersByMainCharacterName = await db.query.userCharacters.findMany({
				where: and(
					eq(userCharacters.isDeleted, false),
					eq(userCharacters.status, 'active'),
					ilike(userCharacters.characterName, `${q}%`)
				),
				columns: { userId: true, characterName: true },
				limit,
			})
			const mainCharacterNameByUserId = new Map<string, string>()
			for (const row of usersByMainCharacterName) {
				if (!row.userId || !row.characterName) continue
				if (!mainCharacterNameByUserId.has(row.userId)) {
					mainCharacterNameByUserId.set(row.userId, row.characterName)
				}
			}
			const userIdsFromNameSearch = [
				...new Set(usersByMainCharacterName.map((row) => row.userId).filter(Boolean)),
			] as string[]
			const nameMatchedUsers =
				userIdsFromNameSearch.length > 0
					? await db.query.users.findMany({
							where: inArray(users.id, userIdsFromNameSearch),
							columns: { id: true, mainCharacterId: true },
							limit,
						})
					: []
			const userRows = [...usersById, ...nameMatchedUsers]
			const deduped = new Map<
				string,
				{ entityId: string; entityType: EntitySearchType; name: string | null }
			>()
			for (const row of userRows) {
				if (!row.id) continue
				const key = `user:${row.id}`
				if (deduped.has(key)) continue
				deduped.set(key, {
					entityId: row.id,
					entityType: 'user',
					name: mainCharacterNameByUserId.get(row.id) ?? null,
				})
			}
			return c.json([...deduped.values()].slice(0, limit))
		}

		return c.json([])
	} catch (error) {
		logger.error('[bills-admin] Error searching entities:', error)
		return c.json({ error: 'Failed to search entities' }, 500)
	}
})

/**
 * GET /bills/statistics
 * Get bill statistics
 */
app.get('/statistics', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const stub = getStub<Bills>(c.env.BILLS, 'default')
		const stats = await stub.getBillStatistics(user.id)

		return c.json(stats)
	} catch (error) {
		logger.error('Error getting bill statistics:', error)
		return c.json({ error: 'Failed to get statistics' }, 500)
	}
})

/**
 * POST /bills/from-template
 * Create a bill from a template
 */
app.post('/from-template', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const data = await c.req.json()
		const stub = getStub<Bills>(c.env.BILLS, 'default')
		const bill = await stub.createBillFromTemplate(user.id, data)

		return c.json(bill, 201)
	} catch (error) {
		logger.error('Error creating bill from template:', error)
		return c.json({ error: 'Failed to create bill from template' }, 500)
	}
})

// ===== Template Routes =====

/**
 * GET /bills/templates
 * List templates
 */
app.get('/templates', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const stub = getStub<Bills>(c.env.BILLS, 'default')
		const templates = await stub.listTemplates(user.id, 'all')

		return c.json(templates)
	} catch (error) {
		logger.error('Error listing templates:', error)
		return c.json({ error: 'Failed to list templates' }, 500)
	}
})

/**
 * POST /bills/templates
 * Create a new template
 */
app.post('/templates', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const data = await c.req.json()
		const stub = getStub<Bills>(c.env.BILLS, 'default')
		const template = await stub.createTemplate(user.id, data)

		return c.json(template, 201)
	} catch (error) {
		logger.error('Error creating template:', error)
		return c.json({ error: 'Failed to create template' }, 500)
	}
})

/**
 * POST /bills/templates/clone
 * Clone an existing template
 */
app.post('/templates/clone', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const data = await c.req.json()
		const stub = getStub<Bills>(c.env.BILLS, 'default')
		const template = await stub.cloneTemplate(user.id, data)

		return c.json(template, 201)
	} catch (error) {
		logger.error('Error cloning template:', error)
		return c.json({ error: 'Failed to clone template' }, 500)
	}
})

/**
 * POST /bills/templates/clone-from-bill
 * Convert a bill into a template
 */
app.post('/templates/clone-from-bill', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const data = await c.req.json()
		const stub = getStub<Bills>(c.env.BILLS, 'default')
		const template = await stub.cloneBillAsTemplate(user.id, data)

		return c.json(template, 201)
	} catch (error) {
		logger.error('Error cloning bill as template:', error)
		return c.json({ error: 'Failed to clone bill as template' }, 500)
	}
})

/**
 * GET /bills/templates/:templateId
 * Get a specific template
 */
app.get('/templates/:templateId', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	const templateId = c.req.param('templateId')

	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const stub = getStub<Bills>(c.env.BILLS, 'default')
		const template = await stub.getTemplate(user.id, templateId, 'all')

		if (!template) {
			return c.json({ error: 'Template not found' }, 404)
		}

		return c.json(template)
	} catch (error) {
		logger.error('Error getting template:', error)
		return c.json({ error: 'Failed to get template' }, 500)
	}
})

/**
 * PUT /bills/templates/:templateId
 * Update a template
 */
app.put('/templates/:templateId', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	const templateId = c.req.param('templateId')

	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const data = await c.req.json()
		const stub = getStub<Bills>(c.env.BILLS, 'default')
		const template = await stub.updateTemplate(user.id, templateId, data, 'all')

		return c.json(template)
	} catch (error) {
		logger.error('Error updating template:', error)
		return c.json({ error: 'Failed to update template' }, 500)
	}
})

/**
 * DELETE /bills/templates/:templateId
 * Delete a template
 */
app.delete('/templates/:templateId', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	const templateId = c.req.param('templateId')

	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const stub = getStub<Bills>(c.env.BILLS, 'default')
		await stub.deleteTemplate(user.id, templateId, 'all')

		return c.json({ success: true })
	} catch (error) {
		logger.error('Error deleting template:', error)
		return c.json({ error: 'Failed to delete template' }, 500)
	}
})

/**
 * GET /bills/:billId
 * Get a specific bill
 */
app.get('/:billId', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	const billId = c.req.param('billId')

	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const stub = getStub<Bills>(c.env.BILLS, 'default')
		const bill = await stub.getBillIntegrationView(billId)

		if (!bill) {
			return c.json({ error: 'Bill not found' }, 404)
		}

		// Resolve entity names (issuer user, EVE entities, and auth groups).
		const resolver = getStub<EsiTypeResolver>(c.env.ESI_TYPE_RESOLVER, 'global')
		const db = createDb(c.env.DATABASE_URL)
		const issuerUser = await db.query.users.findFirst({
			where: eq(users.id, bill.issuerId),
			columns: { mainCharacterId: true },
		})
		const esiIdsToResolve = [
			bill.payerType !== 'group' ? bill.payerId : null,
			bill.payeeId,
			issuerUser?.mainCharacterId ?? null,
			...(bill.payments?.map((payment) =>
				payment.paidByType !== 'group' ? payment.paidById : null
			) ?? []),
		].filter(Boolean) as string[]
		const groupIdsToResolve = [
			bill.payerType === 'group' ? bill.payerId : null,
			...(bill.payments?.map((payment) =>
				payment.paidByType === 'group' ? payment.paidById : null
			) ?? []),
		].filter(Boolean) as string[]
		const nameMap =
			esiIdsToResolve.length > 0 ? await resolver.resolveIds([...new Set(esiIdsToResolve)]) : {}
		const groupNames = await resolveGroupNames(c.env, groupIdsToResolve)

		bill.issuerName = issuerUser?.mainCharacterId
			? (nameMap[issuerUser.mainCharacterId] ?? undefined)
			: undefined
		bill.payerName =
			bill.payerType === 'group'
				? (groupNames.get(bill.payerId) ?? undefined)
				: (nameMap[bill.payerId] ?? undefined)
		if (bill.payeeId) {
			bill.payeeName = nameMap[bill.payeeId] ?? undefined
		}
		if (bill.payments && bill.payments.length > 0) {
			bill.payments = bill.payments.map((payment) => ({
				...payment,
				paidByName:
					payment.paidByType === 'group'
						? (groupNames.get(payment.paidById) ?? undefined)
						: (nameMap[payment.paidById] ?? undefined),
			}))
		}

		return c.json(bill)
	} catch (error) {
		logger.error('Error getting bill:', error)
		return c.json({ error: 'Failed to get bill' }, 500)
	}
})

/**
 * POST /bills
 * Create a new bill
 */
app.post('/', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const data = await c.req.json()
		logger.info('[bills-admin] Creating bill', { userId: user.id, data })

		const stub = getStub<Bills>(c.env.BILLS, 'default')
		const bill = await stub.createBill(user.id, data)

		logger.info('[bills-admin] Bill created successfully', { billId: bill.id })
		return c.json(bill, 201)
	} catch (error) {
		logger.error('Error creating bill:', {
			error: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : undefined,
		})
		return c.json({ error: 'Failed to create bill' }, 500)
	}
})

/**
 * PUT /bills/:billId
 * Update a bill
 */
app.put('/:billId', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	const billId = c.req.param('billId')

	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const data = await c.req.json()
		const stub = getStub<Bills>(c.env.BILLS, 'default')
		const billRecord = await stub.getBillIntegrationView(billId)
		if (!billRecord) {
			return c.json({ error: 'Bill not found' }, 404)
		}
		const bill = await stub.updateBill(user.id, billId, data)

		return c.json(bill)
	} catch (error) {
		logger.error('Error updating bill:', error)
		return c.json({ error: 'Failed to update bill' }, 500)
	}
})

/**
 * DELETE /bills/:billId
 * Delete a bill
 */
app.delete('/:billId', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	const billId = c.req.param('billId')

	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const stub = getStub<Bills>(c.env.BILLS, 'default')
		const bill = await stub.getBillIntegrationView(billId)
		if (!bill) {
			return c.json({ error: 'Bill not found' }, 404)
		}

		// Admin route enforces permission scope; bills domain enforces invariants.
		await stub.deleteBill(user.id, billId)

		return c.json({ success: true })
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		logger.error('Error deleting bill:', error)
		if (message.includes('Only draft bills can be deleted')) {
			return c.json({ error: 'Only draft bills can be deleted' }, 400)
		}
		return c.json({ error: 'Failed to delete bill' }, 500)
	}
})

/**
 * POST /bills/:billId/issue
 * Issue a bill
 */
app.post('/:billId/issue', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	const billId = c.req.param('billId')

	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const stub = getStub<Bills>(c.env.BILLS, 'default')
		const billRecord = await stub.getBillIntegrationView(billId)
		if (!billRecord) {
			return c.json({ error: 'Bill not found' }, 404)
		}
		const bill = await stub.issueBill(user.id, billId)

		return c.json(bill)
	} catch (error) {
		logger.error('Error issuing bill:', error)
		return c.json({ error: 'Failed to issue bill' }, 500)
	}
})

/**
 * POST /bills/:billId/cancel
 * Cancel a bill
 */
app.post('/:billId/cancel', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	const billId = c.req.param('billId')

	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const stub = getStub<Bills>(c.env.BILLS, 'default')
		const billRecord = await stub.getBillIntegrationView(billId)
		if (!billRecord) {
			return c.json({ error: 'Bill not found' }, 404)
		}
		const bill = await stub.cancelBill(user.id, billId)

		return c.json(bill)
	} catch (error) {
		logger.error('Error cancelling bill:', error)
		return c.json({ error: 'Failed to cancel bill' }, 500)
	}
})

/**
 * POST /bills/:billId/revert-to-draft
 * Revert a bill status back to draft
 */
app.post('/:billId/revert-to-draft', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	const billId = c.req.param('billId')

	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const stub = getStub<Bills>(c.env.BILLS, 'default')
		const billRecord = await stub.getBillIntegrationView(billId)
		if (!billRecord) {
			return c.json({ error: 'Bill not found' }, 404)
		}
		const bill = await stub.revertBillToDraft(user.id, billId)

		return c.json(bill)
	} catch (error) {
		logger.error('Error reverting bill to draft:', error)
		return c.json({ error: 'Failed to revert bill to draft' }, 500)
	}
})

/**
 * POST /bills/:billId/regenerate-token
 * Regenerate payment token
 */
app.post('/:billId/regenerate-token', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	const billId = c.req.param('billId')

	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const stub = getStub<Bills>(c.env.BILLS, 'default')
		const billRecord = await stub.getBillIntegrationView(billId)
		if (!billRecord) {
			return c.json({ error: 'Bill not found' }, 404)
		}
		const result = await stub.regeneratePaymentToken(user.id, billId)

		return c.json(result)
	} catch (error) {
		logger.error('Error regenerating token:', error)
		return c.json({ error: 'Failed to regenerate token' }, 500)
	}
})

// ===== Schedule Routes =====

/**
 * GET /bills/schedules
 * List schedules
 */
app.get('/schedules', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const frequency = c.req.query('frequency')
		const isActive =
			c.req.query('isActive') === 'true'
				? true
				: c.req.query('isActive') === 'false'
					? false
					: undefined
		const templateId = c.req.query('templateId')

		const stub = getStub<Bills>(c.env.BILLS, 'default')
		const schedules = await stub.listSchedules(
			user.id,
			{
				frequency: frequency as any,
				isActive,
				templateId,
			},
			'all'
		)

		return c.json(schedules)
	} catch (error) {
		logger.error('Error listing schedules:', error)
		return c.json({ error: 'Failed to list schedules' }, 500)
	}
})

/**
 * POST /bills/schedules
 * Create a new schedule
 */
app.post('/schedules', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const data = await c.req.json()
		const stub = getStub<Bills>(c.env.BILLS, 'default')
		const schedule = await stub.createSchedule(user.id, data)

		return c.json(schedule, 201)
	} catch (error) {
		logger.error('Error creating schedule:', error)
		return c.json({ error: 'Failed to create schedule' }, 500)
	}
})

/**
 * GET /bills/schedules/statistics
 * Get schedule statistics
 */
app.get('/schedules/statistics', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const stub = getStub<Bills>(c.env.BILLS, 'default')
		const stats = await stub.getScheduleStatistics(user.id)

		return c.json(stats)
	} catch (error) {
		logger.error('Error getting schedule statistics:', error)
		return c.json({ error: 'Failed to get statistics' }, 500)
	}
})

/**
 * GET /bills/schedules/:scheduleId/logs
 * Get schedule execution logs
 */
app.get('/schedules/:scheduleId/logs', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	const scheduleId = c.req.param('scheduleId')

	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		// Validate limit parameter
		const pagination = validatePagination(c.req.query('limit'), undefined)
		if (!pagination.success) {
			return c.json({ error: pagination.error }, pagination.status)
		}

		const stub = getStub<Bills>(c.env.BILLS, 'default')
		const logs = await stub.getScheduleExecutionLogs(
			user.id,
			scheduleId,
			pagination.data.limit,
			'all'
		)

		return c.json(logs)
	} catch (error) {
		logger.error('Error getting schedule logs:', error)
		return c.json({ error: 'Failed to get schedule logs' }, 500)
	}
})

/**
 * GET /bills/schedules/:scheduleId
 * Get a specific schedule
 */
app.get('/schedules/:scheduleId', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	const scheduleId = c.req.param('scheduleId')

	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const stub = getStub<Bills>(c.env.BILLS, 'default')
		const schedule = await stub.getSchedule(user.id, scheduleId, 'all')

		if (!schedule) {
			return c.json({ error: 'Schedule not found' }, 404)
		}

		return c.json(schedule)
	} catch (error) {
		logger.error('Error getting schedule:', error)
		return c.json({ error: 'Failed to get schedule' }, 500)
	}
})

/**
 * PUT /bills/schedules/:scheduleId
 * Update a schedule
 */
app.put('/schedules/:scheduleId', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	const scheduleId = c.req.param('scheduleId')

	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const data = await c.req.json()
		const stub = getStub<Bills>(c.env.BILLS, 'default')
		const schedule = await stub.updateSchedule(user.id, scheduleId, data, 'all')

		return c.json(schedule)
	} catch (error) {
		logger.error('Error updating schedule:', error)
		return c.json({ error: 'Failed to update schedule' }, 500)
	}
})

/**
 * DELETE /bills/schedules/:scheduleId
 * Delete a schedule
 */
app.delete('/schedules/:scheduleId', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	const scheduleId = c.req.param('scheduleId')

	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const stub = getStub<Bills>(c.env.BILLS, 'default')
		await stub.deleteSchedule(user.id, scheduleId, 'all')

		return c.json({ success: true })
	} catch (error) {
		logger.error('Error deleting schedule:', error)
		return c.json({ error: 'Failed to delete schedule' }, 500)
	}
})

/**
 * POST /bills/schedules/:scheduleId/pause
 * Pause a schedule
 */
app.post('/schedules/:scheduleId/pause', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	const scheduleId = c.req.param('scheduleId')

	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const stub = getStub<Bills>(c.env.BILLS, 'default')
		const schedule = await stub.pauseSchedule(user.id, scheduleId)

		return c.json(schedule)
	} catch (error) {
		logger.error('Error pausing schedule:', error)
		return c.json({ error: 'Failed to pause schedule' }, 500)
	}
})

/**
 * POST /bills/schedules/:scheduleId/resume
 * Resume a schedule
 */
app.post('/schedules/:scheduleId/resume', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	const scheduleId = c.req.param('scheduleId')

	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const stub = getStub<Bills>(c.env.BILLS, 'default')
		const schedule = await stub.resumeSchedule(user.id, scheduleId)

		return c.json(schedule)
	} catch (error) {
		logger.error('Error resuming schedule:', error)
		return c.json({ error: 'Failed to resume schedule' }, 500)
	}
})

export default app
