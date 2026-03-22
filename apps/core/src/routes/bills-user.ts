/**
 * Bills routes - User-facing operations for viewing bills
 *
 * All endpoints require authentication (no admin required).
 * Users can view bills where they are the payer (via their characters or managed corporations).
 */

import { eq, inArray } from 'drizzle-orm'
import { Hono } from 'hono'

import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

import { createDb } from '../db'
import { userCharacters, users } from '../db/schema'
import { validatePagination } from '../lib/validation'
import { requireAllianceMember } from '../middleware/session'

import type {
	BillFilters,
	BillListScopeEntity,
	BillListSortDirection,
	BillListSortField,
	BillPartyDirection,
	Bills,
	EntityType,
} from '@repo/bills'
import type { EsiTypeResolver } from '@repo/esi'
import type { EveCharacterData } from '@repo/eve-character-data'
import type { EveCorporationData } from '@repo/eve-corporation-data'
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

export interface UserBillScope {
	characterIds: string[]
	corporationIds: string[]
	groupIds: string[]
	partyEntities: BillListScopeEntity[]
}

export function buildMyBillListScope(
	userId: string,
	scope: UserBillScope
): {
	mode: 'my'
	issuerIds: string[]
	partyEntities: BillListScopeEntity[]
} {
	return {
		mode: 'my',
		issuerIds: [userId],
		partyEntities: scope.partyEntities,
	}
}

/**
 * GET /bills/my-bills
 * List bills where the current user is the payer
 * (via their character IDs or corporations where they have CEO/Director roles)
 */
app.get('/my-bills', requireAllianceMember(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const pagination = validatePagination(c.req.query('limit'), c.req.query('offset'))
		if (!pagination.success) {
			return c.json({ error: pagination.error }, pagination.status)
		}
		const filters = parseBillFilters(c)
		const sortByQuery = c.req.query('sortBy')?.trim() as BillListSortField | undefined
		const sortDirQuery = c.req.query('sortDir')?.trim() as BillListSortDirection | undefined
		const sortBy = sortByQuery && BILL_SORT_FIELDS.has(sortByQuery) ? sortByQuery : 'dueDate'
		const sortDir: BillListSortDirection = sortDirQuery === 'desc' ? 'desc' : 'asc'
		const scope = await getUserBillScope(c.env, user.id)
		const stub = getStub<Bills>(c.env.BILLS, 'default')
		const page = await stub.listBillsPage({
			scope: buildMyBillListScope(user.id, scope),
			filters,
			limit: pagination.data.limit,
			offset: pagination.data.offset,
			sortBy,
			sortDir,
		})
		const db = createDb(c.env.DATABASE_URL)
		const issuerIds = [...new Set(page.rows.map((row) => row.issuerId).filter(Boolean))]
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
		const resolver = getStub<EsiTypeResolver>(c.env.ESI_TYPE_RESOLVER, 'global')
		const esiIdsToResolve = [
			...new Set(
				page.rows.flatMap((bill) => [
					bill.payerType !== 'group' ? bill.payerId : null,
					bill.payeeId,
					issuerMainCharacterByUserId.get(bill.issuerId),
				])
			),
		].filter(Boolean) as string[]
		const names = esiIdsToResolve.length > 0 ? await resolver.resolveIds(esiIdsToResolve) : {}
		const groupIds = [
			...new Set(page.rows.flatMap((bill) => [bill.payerType === 'group' ? bill.payerId : null])),
		].filter(Boolean) as string[]
		const groupNames = await resolveGroupNames(c.env, groupIds)
		const rows = page.rows.map((bill) => ({
			...bill,
			payerName:
				bill.payerType === 'group'
					? (groupNames.get(bill.payerId) ?? undefined)
					: (names[bill.payerId] ?? undefined),
			issuerName: (() => {
				const issuerMainCharacterId = issuerMainCharacterByUserId.get(bill.issuerId)
				return issuerMainCharacterId ? (names[issuerMainCharacterId] ?? undefined) : undefined
			})(),
			payeeName: bill.payeeId ? (names[bill.payeeId] ?? undefined) : undefined,
		}))
		logger.info('[bills-user] Bills fetched successfully', {
			userId: user.id,
			count: rows.length,
			rowCount: page.rowCount,
		})
		return c.json({ rows, rowCount: page.rowCount })
	} catch (error) {
		logger.error('[bills-user] Error listing bills:', {
			error: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : undefined,
		})
		return c.json({ error: 'Failed to list bills' }, 500)
	}
})

app.get('/my-bills/parties/search', requireAllianceMember(), async (c) => {
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
		const scope = await getUserBillScope(c.env, user.id)
		const stub = getStub<Bills>(c.env.BILLS, 'default')
		const rows = await stub.searchBillParties({
			scope: buildMyBillListScope(user.id, scope),
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
		logger.error('[bills-user] Error searching parties:', error)
		return c.json({ error: 'Failed to search bill parties' }, 500)
	}
})

/**
 * GET /bills/my-bills/:billId
 * Get a single bill if the current user is the payer
 */
app.get('/my-bills/:billId', requireAllianceMember(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	const billId = c.req.param('billId')

	try {
		logger.info('[bills-user] Fetching single bill for user', { userId: user.id, billId })
		const scope = await getUserBillScope(c.env, user.id)
		const allowedPartyKeys = new Set(
			scope.partyEntities.map((party) => `${party.entityType}:${party.entityId}`)
		)
		const stub = getStub<Bills>(c.env.BILLS, 'default')
		const bill = await stub.getBill(user.id, billId)

		if (!bill) {
			return c.json({ error: 'Bill not found' }, 404)
		}

		const hasIssuerAccess = bill.issuerId === user.id
		const payerKey = `${bill.payerType}:${bill.payerId}`
		const payeeKey = bill.payeeId && bill.payeeType ? `${bill.payeeType}:${bill.payeeId}` : null
		const hasPayerAccess = allowedPartyKeys.has(payerKey)
		const hasPayeeAccess = payeeKey ? allowedPartyKeys.has(payeeKey) : false
		const hasPartyAccess = hasPayerAccess || hasPayeeAccess
		if (!hasIssuerAccess && !hasPartyAccess) {
			logger.warn('[bills-user] User not authorized to view bill', {
				userId: user.id,
				billId,
				issuerId: bill.issuerId,
			})
			return c.json({ error: 'Bill not found' }, 404)
		}

		// Keep draft visibility limited to issuer.
		if (bill.status === 'draft' && bill.issuerId !== user.id) {
			return c.json({ error: 'Bill not found' }, 404)
		}

		// Resolve entity names.
		const resolver = getStub<EsiTypeResolver>(c.env.ESI_TYPE_RESOLVER, 'global')

		const esiIdsToResolve = [bill.payerType !== 'group' ? bill.payerId : null]
		if (bill.payeeId) {
			esiIdsToResolve.push(bill.payeeId)
		}
		const db = createDb(c.env.DATABASE_URL)
		const issuerUser = await db.query.users.findFirst({
			where: eq(users.id, bill.issuerId),
			columns: { mainCharacterId: true },
		})
		if (issuerUser?.mainCharacterId) {
			esiIdsToResolve.push(issuerUser.mainCharacterId)
		}
		if (bill.payments) {
			for (const payment of bill.payments) {
				if (payment.paidByType !== 'group') {
					esiIdsToResolve.push(payment.paidById)
				}
			}
		}
		const groupIdsToResolve = [
			bill.payerType === 'group' ? bill.payerId : null,
			...(bill.payments?.map((payment) =>
				payment.paidByType === 'group' ? payment.paidById : null
			) ?? []),
		].filter(Boolean) as string[]

		const nameMap = await resolver.resolveIds([
			...new Set(esiIdsToResolve.filter(Boolean) as string[]),
		])
		const groupNames = await resolveGroupNames(c.env, groupIdsToResolve)

		// Apply resolved names
		bill.payerName =
			bill.payerType === 'group'
				? (groupNames.get(bill.payerId) ?? undefined)
				: nameMap[bill.payerId] || undefined
		bill.issuerName = issuerUser?.mainCharacterId
			? (nameMap[issuerUser.mainCharacterId] ?? undefined)
			: undefined
		bill.payeeName = bill.payeeId ? nameMap[bill.payeeId] || undefined : undefined

		if (bill.payments) {
			for (const payment of bill.payments) {
				payment.paidByName =
					payment.paidByType === 'group'
						? (groupNames.get(payment.paidById) ?? undefined)
						: nameMap[payment.paidById] || undefined
			}
		}

		logger.info('[bills-user] Bill fetched successfully', { userId: user.id, billId })

		return c.json(bill)
	} catch (error) {
		logger.error('[bills-user] Error fetching bill:', {
			error: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : undefined,
			billId,
		})
		return c.json({ error: 'Failed to fetch bill' }, 500)
	}
})

/**
 * Helper function to get corporation IDs where user has CEO or Director roles
 * Parallelized for performance - fetches all character info and corp data concurrently
 */
async function getCorporationIdsWithRoles(
	env: App['Bindings'],
	characters: Array<{ characterId: string; characterName: string | null }>
): Promise<string[]> {
	const charStub = getStub<EveCharacterData>(env.EVE_CHARACTER_DATA, 'default')

	// Step 1: Fetch all character info in parallel
	const charDataResults = await Promise.all(
		characters.map(async (character) => {
			try {
				const charData = await charStub.getCharacterInfo(character.characterId)
				return {
					characterId: character.characterId,
					corporationId: charData?.corporationId ? String(charData.corporationId) : null,
				}
			} catch (error) {
				logger.warn('[bills-user] Error fetching character data', {
					characterId: character.characterId,
					error: error instanceof Error ? error.message : String(error),
				})
				return { characterId: character.characterId, corporationId: null }
			}
		})
	)

	// Build map of character -> corporation
	const characterCorpMap = new Map<string, string>()
	for (const result of charDataResults) {
		if (result.corporationId) {
			characterCorpMap.set(result.characterId, result.corporationId)
		}
	}

	// Get unique corporation IDs
	const uniqueCorpIds = [...new Set(characterCorpMap.values())]

	// Step 2: Check all corporations for CEO/Director roles in parallel
	const corpResults = await Promise.all(
		uniqueCorpIds.map(async (corpId) => {
			try {
				const corpStub = getStub<EveCorporationData>(env.EVE_CORPORATION_DATA, corpId)
				const [corpInfo, directors] = await Promise.all([
					corpStub.getCorporationInfo(corpId),
					corpStub.getDirectors(corpId),
				])
				return { corpId, corpInfo, directors }
			} catch (error) {
				logger.warn('[bills-user] Error checking corporation roles', {
					corporationId: corpId,
					error: error instanceof Error ? error.message : String(error),
				})
				return null
			}
		})
	)

	// Step 3: Determine which corporations the user has roles in
	const corporationIds: string[] = []
	for (const result of corpResults) {
		if (!result) continue

		const { corpId, corpInfo, directors } = result
		const directorIds = new Set(directors.map((d) => d.characterId))

		// Check if any user character is CEO or Director
		for (const [charId, charCorpId] of characterCorpMap.entries()) {
			if (charCorpId !== corpId) continue

			const isCeo = corpInfo && String(corpInfo.ceoId) === charId
			const isDirector = directorIds.has(charId)

			if (isCeo || isDirector) {
				corporationIds.push(corpId)
				break // Found a role, no need to check more characters for this corp
			}
		}
	}

	return corporationIds
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

async function getGroupIdsWithOwnerAdminAccess(
	env: App['Bindings'],
	userId: string
): Promise<string[]> {
	const groupsStub = getStub<Groups>(env.GROUPS, 'default')
	const memberships = await groupsStub.getUserMemberships(userId)
	return memberships
		.filter((membership) => membership.isOwner || membership.isAdmin)
		.map((membership) => membership.groupId)
}

export async function getUserBillScope(
	env: App['Bindings'],
	userId: string
): Promise<UserBillScope> {
	const db = createDb(env.DATABASE_URL)
	const characters = await db.query.userCharacters.findMany({
		where: eq(userCharacters.userId, userId),
	})
	const characterIds = characters.map((character) => character.characterId)
	const [corporationIds, groupIds] = await Promise.all([
		getCorporationIdsWithRoles(env, characters),
		getGroupIdsWithOwnerAdminAccess(env, userId),
	])
	const partyEntities: BillListScopeEntity[] = [
		...characterIds.map((entityId) => ({ entityId, entityType: 'character' as const })),
		...corporationIds.map((entityId) => ({ entityId, entityType: 'corporation' as const })),
		...groupIds.map((entityId) => ({ entityId, entityType: 'group' as const })),
	]
	return {
		characterIds,
		corporationIds,
		groupIds,
		partyEntities,
	}
}

export default app
