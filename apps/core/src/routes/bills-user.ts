/**
 * Bills routes - User-facing operations for viewing bills
 *
 * All endpoints require authentication (no admin required).
 * Users can view bills where they are the issuer, payer, payee, or an authorized leader of the
 * payee corporation.
 */

import { and, eq, ilike, inArray, or } from 'drizzle-orm'
import { Hono } from 'hono'

import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'
import { parseDateOrNull } from '@repo/worker-utils'

import { createDb } from '../db'
import { managedCorporations, userCharacters, users } from '../db/schema'
import {
	escapeLikePattern,
	manualBillCreateSchema,
	manualBillUpdateSchema,
} from '../lib/bill-validation'
import {
	canAccessBills,
	getBillingIssuerScope,
	hasBaselineBillingIssuerPermission,
	hasBillingIssuerPermission,
	isManualBill,
} from '../lib/billing-access'
import { clearUserBillScopeCache, getCachedUserBillScope } from '../lib/billing-scope-cache'
import { validatePagination } from '../lib/validation'
import { requireAuth } from '../middleware/session'

import type { MiddlewareHandler } from 'hono'
import type {
	BillFilters,
	BillIntegrationView,
	BillListScopeEntity,
	BillListSortDirection,
	BillListSortField,
	BillPartyDirection,
	Bills,
	BillStatus,
	CreateBillInput,
	EntityType,
	GroupBillAggregate,
	UpdateBillInput,
} from '@repo/bills'
import type { EsiTypeResolver } from '@repo/esi'
import type { EveCharacterData } from '@repo/eve-character-data'
import type { EveCorporationData } from '@repo/eve-corporation-data'
import type { Groups } from '@repo/groups'
import type { App } from '../context'
import type { UserBillScope } from '../lib/billing-scope-cache'

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
const BILL_STATUSES = new Set<BillStatus>(['draft', 'issued', 'paid', 'cancelled', 'overdue'])
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isUuid(value: string | null | undefined): value is string {
	return Boolean(value && UUID_REGEX.test(value))
}

const requireBillingViewer = (): MiddlewareHandler<App> => {
	return async (c, next) => {
		const user = c.get('user')
		if (!user) {
			return c.json({ error: 'Unauthorized' }, 401)
		}
		if (!(await canAccessBills(c.env, user))) {
			return c.json({ error: 'Forbidden' }, 403)
		}
		return next()
	}
}

const requireBillingIssuer = (): MiddlewareHandler<App> => {
	return async (c, next) => {
		const user = c.get('user')
		if (!user) {
			return c.json({ error: 'Unauthorized' }, 401)
		}
		if (user.is_admin || (await hasBillingIssuerPermission(c.env, user.id))) {
			return next()
		}
		return c.json({ error: 'Forbidden' }, 403)
	}
}

const requireBaselineBillingIssuer = (): MiddlewareHandler<App> => {
	return async (c, next) => {
		const user = c.get('user')
		if (!user) return c.json({ error: 'Unauthorized' }, 401)
		if (user.is_admin || (await hasBaselineBillingIssuerPermission(c.env, user.id))) {
			return next()
		}
		return c.json({ error: 'Forbidden' }, 403)
	}
}

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

async function findBillPartyNameMatches(
	env: App['Bindings'],
	userId: string,
	query: string,
	entityType: EntityType | undefined,
	partyEntities: BillListScopeEntity[]
): Promise<string[]> {
	const db = createDb(env.DATABASE_URL)
	const ids: string[] = []
	const characterPartyIds = partyEntities
		.filter((party) => party.entityType === 'character')
		.map((party) => party.entityId)
	const corporationPartyIds = partyEntities
		.filter((party) => party.entityType === 'corporation')
		.map((party) => party.entityId)
	const groupPartyIds = new Set(
		partyEntities.filter((party) => party.entityType === 'group').map((party) => party.entityId)
	)
	if (!entityType || entityType === 'character') {
		if (characterPartyIds.length > 0) {
			const characters = await db.query.userCharacters.findMany({
				where: and(
					eq(userCharacters.isDeleted, false),
					eq(userCharacters.status, 'active'),
					inArray(userCharacters.characterId, characterPartyIds),
					ilike(userCharacters.characterName, `${escapeLikePattern(query)}%`)
				),
				columns: { characterId: true },
				limit: 100,
			})
			ids.push(...characters.map((character) => character.characterId))
		}
	}
	if (!entityType || entityType === 'corporation') {
		if (corporationPartyIds.length > 0) {
			const corporations = await db.query.managedCorporations.findMany({
				where: and(
					eq(managedCorporations.isActive, true),
					inArray(managedCorporations.corporationId, corporationPartyIds),
					ilike(managedCorporations.name, `${escapeLikePattern(query)}%`)
				),
				columns: { corporationId: true },
				limit: 100,
			})
			ids.push(...corporations.map((corporation) => corporation.corporationId))
		}
	}
	if (!entityType || entityType === 'group') {
		if (groupPartyIds.size > 0) {
			const groupsStub = getStub<Groups>(env.GROUPS, 'default')
			const groups = await groupsStub.listGroups({ search: query, limit: 100, offset: 0 }, userId)
			ids.push(...groups.filter((group) => groupPartyIds.has(group.id)).map((group) => group.id))
		}
	}
	return [...new Set(ids)]
}

export { clearUserBillScopeCache }
export type { UserBillScope } from '../lib/billing-scope-cache'

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

function canViewMyBill(
	userId: string,
	bill: Pick<BillIntegrationView, 'issuerId' | 'payerId' | 'payerType' | 'payeeId' | 'payeeType'>,
	scope: UserBillScope
): boolean {
	return bill.issuerId === userId || isRelatedToBill(bill, scope)
}

function isRelatedToBill(
	bill: Pick<BillIntegrationView, 'payerId' | 'payerType' | 'payeeId' | 'payeeType'>,
	scope: UserBillScope
): boolean {
	return scope.partyEntities.some((party) => {
		const isPayer = bill.payerId === party.entityId && bill.payerType === party.entityType
		const isPayee =
			party.entityType !== 'group' &&
			bill.payeeId === party.entityId &&
			bill.payeeType === party.entityType
		return isPayer || isPayee
	})
}

function isMarkPaidStatus(status: BillStatus): boolean {
	return status !== 'draft' && status !== 'paid' && status !== 'cancelled'
}

async function getOwnedManualBill(
	env: App['Bindings'],
	userId: string,
	billId: string
): Promise<{ stub: Bills; bill: Awaited<ReturnType<Bills['getBillIntegrationView']>> } | null> {
	const stub = getStub<Bills>(env.BILLS, 'default')
	const bill = await stub.getBillIntegrationView(billId)
	if (!bill || bill.issuerId !== userId || !isManualBill(bill)) {
		return null
	}
	return { stub, bill }
}

async function getOwnedIssuedBill(
	env: App['Bindings'],
	userId: string,
	billId: string
): Promise<{ stub: Bills; bill: Awaited<ReturnType<Bills['getBillIntegrationView']>> } | null> {
	const stub = getStub<Bills>(env.BILLS, 'default')
	const bill = await stub.getBillIntegrationView(billId)
	if (!bill || bill.issuerId !== userId) return null
	return { stub, bill }
}

async function getOwnedGroupBill(
	env: App['Bindings'],
	userId: string,
	groupBillId: string
): Promise<{ stub: Bills; aggregate: GroupBillAggregate } | null> {
	const stub = getStub<Bills>(env.BILLS, 'default')
	const aggregate = await stub.getGroupBillAggregate(groupBillId)
	if (!aggregate || aggregate.issuerId !== userId) return null
	return { stub, aggregate }
}

async function enrichGroupBillAggregate(
	c: App['Bindings'],
	aggregate: GroupBillAggregate
): Promise<GroupBillAggregate> {
	const resolver = getStub<EsiTypeResolver>(c.ESI_TYPE_RESOLVER, 'global')
	const payerIds = [...new Set(aggregate.bills.map((bill) => bill.payerId).filter(Boolean))]
	const nameMap = payerIds.length > 0 ? await resolver.resolveIds(payerIds) : {}
	const groupNames = aggregate.groupId
		? await resolveGroupNames(c, [aggregate.groupId])
		: new Map<string, string>()
	const db = createDb(c.DATABASE_URL)
	const issuerUser = await db.query.users.findFirst({
		where: eq(users.id, aggregate.issuerId),
		columns: { mainCharacterId: true },
	})
	const issuerNames = issuerUser?.mainCharacterId
		? await resolver.resolveIds([issuerUser.mainCharacterId])
		: {}
	return {
		...aggregate,
		groupName: aggregate.groupId ? groupNames.get(aggregate.groupId) : undefined,
		issuerName: issuerUser?.mainCharacterId
			? (issuerNames[issuerUser.mainCharacterId] ?? undefined)
			: undefined,
		bills: aggregate.bills.map((bill) => ({
			...bill,
			payerName: nameMap[bill.payerId] ?? undefined,
		})),
	}
}

app.post('/issued', requireAuth(), requireBillingIssuer(), async (c) => {
	const user = c.get('user')
	if (!user) return c.json({ error: 'Unauthorized' }, 401)

	try {
		let body: unknown
		try {
			body = await c.req.json()
		} catch {
			return c.json({ error: 'Invalid JSON request body' }, 400)
		}
		const parsed = manualBillCreateSchema.safeParse(body)
		if (!parsed.success) {
			return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid bill data' }, 400)
		}
		const dueDate = parseDateOrNull(parsed.data.dueDate)
		if (!dueDate) return c.json({ error: 'Invalid due date' }, 400)
		const issuerScope = user.is_admin
			? { unrestricted: true, corporationIds: [] }
			: await getBillingIssuerScope(c.env, user.id)
		const { groupBillOptions, ...billData } = parsed.data
		if (!issuerScope.unrestricted) {
			if (billData.payerType !== 'character') {
				return c.json({ error: 'Scoped issuer permissions require a character payer' }, 400)
			}
			if (issuerScope.corporationIds.length === 0) {
				return c.json({ error: 'Issuer permission has no corporation scope' }, 403)
			}
			const db = createDb(c.env.DATABASE_URL)
			const scopedCorporationIds = issuerScope.corporationIds
			const payerRows = await db.query.userCharacters.findMany({
				where: and(
					eq(userCharacters.characterId, billData.payerId),
					eq(userCharacters.isDeleted, false),
					eq(userCharacters.status, 'active'),
					inArray(userCharacters.corporationId, scopedCorporationIds)
				),
				columns: { characterId: true },
				limit: 1,
			})
			if (payerRows.length === 0) {
				return c.json({ error: 'Payer character is outside the issuer corporation scope' }, 400)
			}
			if (billData.payeeType === 'corporation') {
				const payeeRows = await db.query.managedCorporations.findMany({
					where: and(
						eq(managedCorporations.isActive, true),
						inArray(managedCorporations.corporationId, scopedCorporationIds),
						eq(managedCorporations.corporationId, billData.payeeId)
					),
					columns: { corporationId: true },
					limit: 1,
				})
				if (payeeRows.length === 0) {
					return c.json({ error: 'Payee corporation is outside the issuer corporation scope' }, 400)
				}
			} else {
				const payeeRows = await db.query.userCharacters.findMany({
					where: and(
						eq(userCharacters.characterId, billData.payeeId),
						eq(userCharacters.isDeleted, false),
						eq(userCharacters.status, 'active'),
						inArray(userCharacters.corporationId, scopedCorporationIds)
					),
					columns: { characterId: true },
					limit: 1,
				})
				if (payeeRows.length === 0) {
					return c.json({ error: 'Payee character is outside the issuer corporation scope' }, 400)
				}
			}
		}

		const stub = getStub<Bills>(c.env.BILLS, 'default')
		if (billData.payerType === 'group') {
			const options = groupBillOptions ?? {
				includeOwner: true,
				includeAdmins: true,
				includeMembers: true,
			}
			if (!options.includeOwner && !options.includeAdmins && !options.includeMembers) {
				return c.json({ error: 'At least one member role must be selected for group bills' }, 400)
			}
			const groupsStub = getStub<Groups>(c.env.GROUPS, 'default')
			const [group, members] = await Promise.all([
				groupsStub.getGroup(billData.payerId, user.id),
				groupsStub.getGroupMembers(billData.payerId, user.id),
			])
			if (!group) return c.json({ error: 'Group not found' }, 404)
			const adminUserIds = new Set(group.adminUserIds ?? [])
			const groupBillId = crypto.randomUUID()
			const bulkData: CreateBillInput[] = []
			for (const member of members) {
				if (!member.mainCharacterId) continue
				const isOwner = member.userId === group.ownerId
				const isAdmin = adminUserIds.has(member.userId)
				if (isOwner && !options.includeOwner) continue
				if (isAdmin && !options.includeAdmins) continue
				if (!isOwner && !isAdmin && !options.includeMembers) continue
				bulkData.push({
					...billData,
					dueDate,
					payerType: 'character',
					payerId: member.mainCharacterId,
					groupBillId,
					externalMetadata: { groupId: billData.payerId },
				})
			}
			if (bulkData.length === 0) {
				return c.json({ error: 'No qualifying group members with a main character found' }, 400)
			}
			const createdBills = await stub.createBillsBulk(user.id, bulkData)
			return c.json({ groupBillId, bills: createdBills, billCount: createdBills.length }, 201)
		}
		const bill = await stub.createBill(user.id, { ...billData, dueDate })
		return c.json(bill, 201)
	} catch (error) {
		logger.error('[bills-user] Error creating issuer bill:', error)
		return c.json({ error: 'Failed to create bill' }, 500)
	}
})

app.get('/issued/scope', requireAuth(), requireBillingIssuer(), async (c) => {
	const user = c.get('user')
	if (!user) return c.json({ error: 'Unauthorized' }, 401)
	const scope = user.is_admin
		? { unrestricted: true, corporationIds: [] }
		: await getBillingIssuerScope(c.env, user.id)
	if (scope.unrestricted || scope.corporationIds.length === 0) {
		return c.json({ ...scope, corporations: [] })
	}
	const db = createDb(c.env.DATABASE_URL)
	const corporations = await db.query.managedCorporations.findMany({
		where: and(
			eq(managedCorporations.isActive, true),
			inArray(managedCorporations.corporationId, scope.corporationIds)
		),
		columns: { corporationId: true, name: true },
		orderBy: (table, { asc }) => [asc(table.name)],
	})
	return c.json({ ...scope, corporations })
})

app.get('/my-bills/group/:groupBillId', requireAuth(), requireBillingViewer(), async (c) => {
	const user = c.get('user')
	if (!user) return c.json({ error: 'Unauthorized' }, 401)
	try {
		const owned = await getOwnedGroupBill(c.env, user.id, c.req.param('groupBillId'))
		if (!owned) return c.json({ error: 'Group bill not found' }, 404)
		return c.json(await enrichGroupBillAggregate(c.env, owned.aggregate))
	} catch (error) {
		logger.error('[bills-user] Error getting owned group bill:', error)
		return c.json({ error: 'Failed to get group bill' }, 500)
	}
})

app.get('/issued/group/:groupBillId', requireAuth(), requireBaselineBillingIssuer(), async (c) => {
	const user = c.get('user')
	if (!user) return c.json({ error: 'Unauthorized' }, 401)
	try {
		const owned = await getOwnedGroupBill(c.env, user.id, c.req.param('groupBillId'))
		if (!owned) return c.json({ error: 'Group bill not found' }, 404)
		return c.json(await enrichGroupBillAggregate(c.env, owned.aggregate))
	} catch (error) {
		logger.error('[bills-user] Error getting issuer group bill:', error)
		return c.json({ error: 'Failed to get group bill' }, 500)
	}
})

for (const action of ['issue', 'cancel', 'revert-to-draft'] as const) {
	app.post(
		`/issued/group/:groupBillId/${action}`,
		requireAuth(),
		requireBaselineBillingIssuer(),
		async (c) => {
			const user = c.get('user')
			if (!user) return c.json({ error: 'Unauthorized' }, 401)
			try {
				const owned = await getOwnedGroupBill(c.env, user.id, c.req.param('groupBillId'))
				if (!owned) return c.json({ error: 'Group bill not found' }, 404)
				if (action === 'issue') {
					return c.json(await owned.stub.issueGroupBill(user.id, c.req.param('groupBillId')))
				}
				if (action === 'cancel') {
					return c.json(await owned.stub.cancelGroupBill(user.id, c.req.param('groupBillId')))
				}
				return c.json(await owned.stub.revertGroupBillToDraft(user.id, c.req.param('groupBillId')))
			} catch (error) {
				logger.error(`[bills-user] Error applying group bill action: ${action}`, error)
				return c.json({ error: `Failed to ${action} group bill` }, 500)
			}
		}
	)
}

app.delete(
	'/issued/group/:groupBillId',
	requireAuth(),
	requireBaselineBillingIssuer(),
	async (c) => {
		const user = c.get('user')
		if (!user) return c.json({ error: 'Unauthorized' }, 401)
		try {
			const owned = await getOwnedGroupBill(c.env, user.id, c.req.param('groupBillId'))
			if (!owned) return c.json({ error: 'Group bill not found' }, 404)
			return c.json(await owned.stub.deleteGroupBill(user.id, c.req.param('groupBillId')))
		} catch (error) {
			logger.error('[bills-user] Error deleting issuer group bill:', error)
			return c.json({ error: 'Failed to delete group bill' }, 500)
		}
	}
)

app.put('/issued/group/:groupBillId', requireAuth(), requireBaselineBillingIssuer(), async (c) => {
	const user = c.get('user')
	if (!user) return c.json({ error: 'Unauthorized' }, 401)
	try {
		const owned = await getOwnedGroupBill(c.env, user.id, c.req.param('groupBillId'))
		if (!owned) return c.json({ error: 'Group bill not found' }, 404)
		let body: unknown
		try {
			body = await c.req.json()
		} catch {
			return c.json({ error: 'Invalid JSON request body' }, 400)
		}
		const parsed = manualBillUpdateSchema.safeParse(body)
		if (!parsed.success) {
			return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid bill data' }, 400)
		}
		const { dueDate: dueDateValue, ...updateValues } = parsed.data
		const data: UpdateBillInput = { ...updateValues }
		if (dueDateValue) {
			const dueDate = parseDateOrNull(dueDateValue)
			if (!dueDate) return c.json({ error: 'Invalid due date' }, 400)
			data.dueDate = dueDate
		}
		return c.json(await owned.stub.updateGroupBill(user.id, c.req.param('groupBillId'), data))
	} catch (error) {
		logger.error('[bills-user] Error updating issuer group bill:', error)
		return c.json({ error: 'Failed to update group bill' }, 500)
	}
})

app.get('/issued', requireAuth(), requireBillingIssuer(), async (c) => {
	const user = c.get('user')
	if (!user) return c.json({ error: 'Unauthorized' }, 401)

	try {
		const pagination = validatePagination(c.req.query('limit'), c.req.query('offset'))
		if (!pagination.success) return c.json({ error: pagination.error }, pagination.status)
		const sortByQuery = c.req.query('sortBy')?.trim() as BillListSortField | undefined
		const sortDirQuery = c.req.query('sortDir')?.trim() as BillListSortDirection | undefined
		const sortBy = sortByQuery && BILL_SORT_FIELDS.has(sortByQuery) ? sortByQuery : 'createdAt'
		const sortDir: BillListSortDirection = sortDirQuery === 'asc' ? 'asc' : 'desc'
		const stub = getStub<Bills>(c.env.BILLS, 'default')
		const parsedFilters = parseBillFilters(c)
		if (!parsedFilters.success) return c.json({ error: parsedFilters.error }, 400)
		const page = await stub.listBillsPage({
			scope: { mode: 'my', issuerIds: [user.id], partyEntities: [] },
			filters: parsedFilters.filters,
			limit: pagination.data.limit,
			offset: pagination.data.offset,
			sortBy,
			sortDir,
			coalesced: false,
		})
		return c.json(page)
	} catch (error) {
		logger.error('[bills-user] Error listing issuer bills:', error)
		return c.json({ error: 'Failed to list issuer bills' }, 500)
	}
})

app.get('/issued/entities/search', requireAuth(), requireBillingIssuer(), async (c) => {
	const user = c.get('user')
	if (!user) return c.json({ error: 'Unauthorized' }, 401)
	const q = c.req.query('q')?.trim() ?? ''
	if (q.length < 2) return c.json([])
	const entityType = c.req.query('entityType')?.trim()
	if (entityType !== 'character' && entityType !== 'corporation') {
		return c.json({ error: 'Issuer search supports character or corporation entities only' }, 400)
	}

	try {
		const limit = Math.max(1, Math.min(100, Number(c.req.query('limit') ?? 25)))
		const db = createDb(c.env.DATABASE_URL)
		const issuerScope = user.is_admin
			? { unrestricted: true, corporationIds: [] }
			: await getBillingIssuerScope(c.env, user.id)
		if (!issuerScope.unrestricted && issuerScope.corporationIds.length === 0) {
			return c.json([])
		}
		const numericQuery = /^\d+$/.test(q)
		if (entityType === 'corporation') {
			const rows = await db.query.managedCorporations.findMany({
				where: and(
					eq(managedCorporations.isActive, true),
					!issuerScope.unrestricted
						? inArray(managedCorporations.corporationId, issuerScope.corporationIds)
						: undefined,
					or(
						ilike(managedCorporations.name, `${q}%`),
						numericQuery ? eq(managedCorporations.corporationId, q) : undefined
					)
				),
				orderBy: (table, { asc }) => [asc(table.name)],
				limit,
			})
			return c.json(
				rows.map((row) => ({
					entityId: row.corporationId,
					entityType: 'corporation' as const,
					name: row.name,
				}))
			)
		}

		const rows = await db.query.userCharacters.findMany({
			where: and(
				eq(userCharacters.isDeleted, false),
				eq(userCharacters.status, 'active'),
				!issuerScope.unrestricted
					? inArray(userCharacters.corporationId, issuerScope.corporationIds)
					: undefined,
				or(
					ilike(userCharacters.characterName, `${q}%`),
					numericQuery ? eq(userCharacters.characterId, q) : undefined
				)
			),
			orderBy: (table, { asc }) => [asc(table.characterName)],
			limit,
		})
		return c.json(
			rows.map((row) => ({
				entityId: row.characterId,
				entityType: 'character' as const,
				name: row.characterName,
			}))
		)
	} catch (error) {
		logger.error('[bills-user] Error searching issuer bill entities:', error)
		return c.json({ error: 'Failed to search bill entities' }, 500)
	}
})

app.get('/issued/:billId', requireAuth(), requireBillingIssuer(), async (c) => {
	const user = c.get('user')
	if (!user) return c.json({ error: 'Unauthorized' }, 401)
	const owned = await getOwnedManualBill(c.env, user.id, c.req.param('billId'))
	return owned ? c.json(owned.bill) : c.json({ error: 'Bill not found' }, 404)
})

app.put('/issued/:billId', requireAuth(), requireBillingIssuer(), async (c) => {
	const user = c.get('user')
	if (!user) return c.json({ error: 'Unauthorized' }, 401)
	try {
		const owned = await getOwnedManualBill(c.env, user.id, c.req.param('billId'))
		if (!owned) return c.json({ error: 'Bill not found' }, 404)
		let body: unknown
		try {
			body = await c.req.json()
		} catch {
			return c.json({ error: 'Invalid JSON request body' }, 400)
		}
		const parsed = manualBillUpdateSchema.safeParse(body)
		if (!parsed.success) {
			return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid bill data' }, 400)
		}
		const { dueDate: dueDateValue, ...updateValues } = parsed.data
		const data: UpdateBillInput = { ...updateValues }
		if (dueDateValue) {
			const dueDate = parseDateOrNull(dueDateValue)
			if (!dueDate) return c.json({ error: 'Invalid due date' }, 400)
			data.dueDate = dueDate
		}
		const bill = await owned.stub.updateBill(user.id, c.req.param('billId'), data)
		return c.json(bill)
	} catch (error) {
		logger.error('[bills-user] Error updating issuer bill:', error)
		return c.json({ error: 'Failed to update bill' }, 500)
	}
})

app.delete('/issued/:billId', requireAuth(), requireBillingIssuer(), async (c) => {
	const user = c.get('user')
	if (!user) return c.json({ error: 'Unauthorized' }, 401)
	try {
		const owned = await getOwnedManualBill(c.env, user.id, c.req.param('billId'))
		if (!owned) return c.json({ error: 'Bill not found' }, 404)
		await owned.stub.deleteBill(user.id, c.req.param('billId'))
		return c.json({ success: true })
	} catch (error) {
		logger.error('[bills-user] Error deleting issuer bill:', error)
		return c.json({ error: 'Failed to delete bill' }, 500)
	}
})

for (const action of [
	'issue',
	'cancel',
	'mark-paid',
	'revert-to-draft',
	'regenerate-token',
] as const) {
	app.post(`/issued/:billId/${action}`, requireAuth(), requireBillingIssuer(), async (c) => {
		const user = c.get('user')
		if (!user) return c.json({ error: 'Unauthorized' }, 401)
		try {
			const billId = c.req.param('billId')
			const owned =
				action === 'mark-paid'
					? await getOwnedIssuedBill(c.env, user.id, billId)
					: await getOwnedManualBill(c.env, user.id, billId)
			if (!owned) return c.json({ error: 'Bill not found' }, 404)
			if (action === 'issue') return c.json(await owned.stub.issueBill(user.id, billId))
			if (action === 'cancel') return c.json(await owned.stub.cancelBill(user.id, billId))
			if (action === 'mark-paid') {
				return c.json(await owned.stub.markBillPaid(user.id, billId, 'owner'))
			}
			if (action === 'revert-to-draft') {
				return c.json(await owned.stub.revertBillToDraft(user.id, billId))
			}
			return c.json(await owned.stub.regeneratePaymentToken(user.id, billId))
		} catch (error) {
			logger.error(`[bills-user] Error applying issuer bill action: ${action}`, error)
			return c.json({ error: `Failed to ${action} bill` }, 500)
		}
	})
}

/**
 * GET /bills/my-bills
 * List bills related to the current user as issuer, payer, payee, or payee-corporation leader.
 */
app.get('/my-bills', requireAuth(), requireBillingViewer(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const canIssueBills = user.is_admin || (await hasBillingIssuerPermission(c.env, user.id))
		const pagination = validatePagination(c.req.query('limit'), c.req.query('offset'))
		if (!pagination.success) {
			return c.json({ error: pagination.error }, pagination.status)
		}
		const parsedFilters = parseBillFilters(c)
		if (!parsedFilters.success) return c.json({ error: parsedFilters.error }, 400)
		const filters = parsedFilters.filters
		filters.includeOverdueBeyondDueAfter = true
		const sortByQuery = c.req.query('sortBy')?.trim() as BillListSortField | undefined
		const sortDirQuery = c.req.query('sortDir')?.trim() as BillListSortDirection | undefined
		const sortBy = sortByQuery && BILL_SORT_FIELDS.has(sortByQuery) ? sortByQuery : 'dueDate'
		const sortDir: BillListSortDirection = sortDirQuery === 'desc' ? 'desc' : 'asc'
		const stub = getStub<Bills>(c.env.BILLS, 'default')
		const userBillScope = await getUserBillScope(c.env, user.id)
		const scope = buildMyBillListScope(user.id, userBillScope)
		const page = await stub.listBillsPage({
			scope,
			filters,
			limit: pagination.data.limit,
			offset: pagination.data.offset,
			sortBy,
			sortDir,
			coalesced: true,
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
			...new Set(
				page.rows.flatMap((bill) => {
					const ids: string[] = []
					if (bill.payerType === 'group') ids.push(bill.payerId)
					const metaGroupId =
						bill.groupBillId &&
						bill.externalMetadata &&
						typeof (bill.externalMetadata as Record<string, unknown>).groupId === 'string'
							? ((bill.externalMetadata as Record<string, unknown>).groupId as string)
							: null
					if (metaGroupId) ids.push(metaGroupId)
					return ids
				})
			),
		].filter(Boolean) as string[]
		const groupNames = await resolveGroupNames(c.env, groupIds)
		const enrichedRows = page.rows.map((bill) => ({
			...bill,
			canMarkPaid: canIssueBills && isMarkPaidStatus(bill.status) && bill.issuerId === user.id,
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

		const rows = enrichedRows.map((row) =>
			// A single visible child is a payer-only view, not a group aggregate.
			row.groupBillTotalCount === 1 ? { ...row, groupBillId: null } : row
		)

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

app.get('/my-bills/parties/search', requireAuth(), requireBillingViewer(), async (c) => {
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
		const scope = buildMyBillListScope(user.id, await getUserBillScope(c.env, user.id))
		const nameMatches =
			q && !/^\d+$/.test(q)
				? await findBillPartyNameMatches(c.env, user.id, q, entityType, scope.partyEntities)
				: undefined
		const rows = await stub.searchBillParties({
			scope,
			direction,
			entityType,
			q: /^\d+$/.test(q) ? q : undefined,
			entityIds: nameMatches,
			limit,
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
		const filteredRows = rows
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
 * Get a single bill if it is related to the current user.
 */
app.get('/my-bills/:billId', requireAuth(), requireBillingViewer(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	const billId = c.req.param('billId')

	try {
		logger.info('[bills-user] Fetching single bill for user', { userId: user.id, billId })
		const stub = getStub<Bills>(c.env.BILLS, 'default')
		const bill = await stub.getBillIntegrationView(billId)

		if (!bill) {
			return c.json({ error: 'Bill not found' }, 404)
		}

		const scope = await getUserBillScope(c.env, user.id)
		if (!canViewMyBill(user.id, bill, scope)) {
			logger.warn('[bills-user] User not authorized to view bill', {
				userId: user.id,
				billId,
				issuerId: bill.issuerId,
			})
			return c.json({ error: 'Forbidden' }, 403)
		}

		// Keep draft visibility limited to issuer.
		if (bill.status === 'draft' && bill.issuerId !== user.id) {
			return c.json({ error: 'Bill not found' }, 404)
		}
		const canIssueBills = user.is_admin || (await hasBillingIssuerPermission(c.env, user.id))
		bill.canMarkPaid = canIssueBills && isMarkPaidStatus(bill.status) && bill.issuerId === user.id

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
		const paymentPaidByIds = bill.payments?.map((payment) => payment.paidById) ?? []
		const paymentUserIds = [...new Set(paymentPaidByIds.filter(isUuid))]
		const paymentUsers =
			paymentUserIds.length > 0
				? await db.query.users.findMany({
						where: inArray(users.id, paymentUserIds),
						columns: { id: true, mainCharacterId: true },
					})
				: []
		const userMainCharacterByUserId = new Map(
			paymentUsers
				.map((entry) => [entry.id, entry.mainCharacterId] as const)
				.filter((entry): entry is readonly [string, string] => Boolean(entry[1]))
		)
		if (issuerUser?.mainCharacterId) {
			esiIdsToResolve.push(issuerUser.mainCharacterId)
		}
		if (bill.payments) {
			for (const payment of bill.payments) {
				if (
					payment.paidByType !== 'group' &&
					payment.paidById !== 'system' &&
					!isUuid(payment.paidById)
				) {
					esiIdsToResolve.push(payment.paidById)
				}
			}
		}
		for (const mainCharacterId of userMainCharacterByUserId.values()) {
			esiIdsToResolve.push(mainCharacterId)
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
					payment.paidById === 'system'
						? 'System'
						: payment.paidByType === 'group'
							? (groupNames.get(payment.paidById) ?? undefined)
							: (nameMap[payment.paidById] ??
								(userMainCharacterByUserId.get(payment.paidById)
									? nameMap[userMainCharacterByUserId.get(payment.paidById)!]
									: undefined) ??
								undefined)
			}
		}

		logger.info('[bills-user] Bill fetched successfully', { userId: user.id, billId })

		return c.json(bill)
	} catch (error) {
		if (error instanceof Error && error.message.includes('Not authorized to view this bill')) {
			return c.json({ error: 'Forbidden' }, 403)
		}
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
	const roleCorporationIds: string[] = []
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
				roleCorporationIds.push(corpId)
				break // Found a role, no need to check more characters for this corp
			}
		}
	}

	const db = createDb(env.DATABASE_URL)
	const memberCorporations = await db.query.managedCorporations.findMany({
		where: and(
			eq(managedCorporations.isActive, true),
			eq(managedCorporations.isMemberCorporation, true),
			inArray(managedCorporations.corporationId, [...new Set(roleCorporationIds)])
		),
		columns: { corporationId: true },
	})
	const memberCorporationIds = new Set(
		memberCorporations.map((corporation) => corporation.corporationId)
	)
	return roleCorporationIds.filter((corporationId) => memberCorporationIds.has(corporationId))
}

function parseBillFilters(c: {
	req: { query: (key: string) => string | undefined }
}): { success: true; filters: BillFilters } | { success: false; error: string } {
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
	if (status) {
		if (!BILL_STATUSES.has(status as BillStatus)) {
			return { success: false, error: 'Invalid bill status' }
		}
		filters.status = status as BillFilters['status']
	}
	if (payerId) filters.payerId = payerId
	if (payeeId) filters.payeeId = payeeId
	if (issuerId) filters.issuerId = issuerId
	if (payerType) {
		if (!ENTITY_TYPES.has(payerType as EntityType)) {
			return { success: false, error: 'Invalid payer type' }
		}
		filters.payerType = payerType as EntityType
	}
	if (payeeType) {
		if (!PAYEE_ENTITY_TYPES.has(payeeType as EntityType)) {
			return { success: false, error: 'Invalid payee type' }
		}
		filters.payeeType = payeeType as EntityType
	}
	for (const [rawValue, label, assign] of [
		[dueAfter, 'dueAfter', (date: Date) => (filters.dueAfter = date)],
		[dueBefore, 'dueBefore', (date: Date) => (filters.dueBefore = date)],
		[createdAfter, 'createdAfter', (date: Date) => (filters.createdAfter = date)],
		[createdBefore, 'createdBefore', (date: Date) => (filters.createdBefore = date)],
	] as const) {
		if (!rawValue) continue
		const parsed = parseDateOrNull(rawValue)
		if (!parsed) return { success: false, error: `Invalid ${label} date` }
		assign(parsed)
	}
	return { success: true, filters }
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

async function loadUserBillScope(env: App['Bindings'], userId: string): Promise<UserBillScope> {
	const db = createDb(env.DATABASE_URL)
	const characters = await db.query.userCharacters.findMany({
		where: and(
			eq(userCharacters.userId, userId),
			eq(userCharacters.isDeleted, false),
			eq(userCharacters.status, 'active')
		),
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

export async function getUserBillScope(
	env: App['Bindings'],
	userId: string
): Promise<UserBillScope> {
	return getCachedUserBillScope(env, userId, () => loadUserBillScope(env, userId))
}

export default app
