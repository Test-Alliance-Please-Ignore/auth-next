import { Hono } from 'hono'
import { z } from 'zod'

import { and, desc, eq, gt, inArray, lte, or } from '@repo/db-utils'
import { MUMBLE_FEATURE_FLAG_KEY } from '@repo/features'

import { createDb } from '../db'
import { mumbleTempopGuests, mumbleTempops, userCharacters, users } from '../db/schema'
import { getCachedUserPermissions } from '../lib/groups-cache'
import { requireAllianceMember } from '../middleware/session'
import { createTempop, deleteTempop, resolveTempopTtlSeconds } from '../services/mumble-tempop.service'
import { resolveFlag } from './flags'

import type { App, Env, SessionUser } from '../context'
import type { createDb as createDbType } from '../db'

const TEMPOP_CREATE_URN = 'urn:mumble:tempop:create'
const TEMPOP_DELETE_URN = 'urn:mumble:tempop:delete'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Db = ReturnType<typeof createDbType>

/** Site admins bypass; otherwise the user must hold the given permission URN. */
async function hasTempopPermission(env: Env, user: SessionUser, urn: string): Promise<boolean> {
	if (user.is_admin) return true
	const permissions = await getCachedUserPermissions(env, user.id)
	return permissions.some((permission) => permission.urn === urn)
}

/** Resolve creator user ids to their main character name. */
async function resolveCreatorNames(db: Db, userIds: string[]): Promise<Map<string, string | null>> {
	const map = new Map<string, string | null>()
	if (userIds.length === 0) return map
	const rows = await db
		.select({ userId: users.id, name: userCharacters.characterName })
		.from(users)
		.leftJoin(userCharacters, eq(userCharacters.characterId, users.mainCharacterId))
		.where(inArray(users.id, userIds))
	for (const row of rows) map.set(row.userId, row.name ?? null)
	return map
}

/** Distinct creators across all temp-ops, for the filter dropdown. */
async function listDistinctCreators(db: Db): Promise<Array<{ id: string; name: string | null }>> {
	const rows = await db
		.selectDistinct({ userId: mumbleTempops.creatorUserId, name: userCharacters.characterName })
		.from(mumbleTempops)
		.leftJoin(users, eq(users.id, mumbleTempops.creatorUserId))
		.leftJoin(userCharacters, eq(userCharacters.characterId, users.mainCharacterId))
	return rows.map((row) => ({ id: row.userId, name: row.name ?? null }))
}

/**
 * Mumble temp-op management routes (authenticated).
 *
 * Gated by the Mumble feature flag and alliance membership; individual routes
 * additionally require `urn:mumble:tempop:create` or `urn:mumble:tempop:delete`
 * (site admins bypass both).
 */
const tempop = new Hono<App>()
	.use('*', async (c, next) => {
		const enabled = await resolveFlag(c.env.FEATURES, MUMBLE_FEATURE_FLAG_KEY, false)
		if (!enabled) {
			return c.json({ error: 'Mumble feature is disabled' }, 404)
		}
		await next()
	})
	.use('*', requireAllianceMember())

const createSchema = z.object({
	ttlPreset: z.enum(['1h', '4h', '6h']).optional(),
	customHours: z.number().positive().max(12).optional(),
})

const listQuerySchema = z.object({
	status: z.enum(['active', 'expired', 'deleted', 'all']).default('active'),
	creatorId: z.string().optional(),
	mine: z.string().optional(),
	limit: z.coerce.number().int().min(1).max(100).default(50),
	offset: z.coerce.number().int().min(0).default(0),
})

/**
 * POST /api/mumble-tempop
 * Create a temp-op. Returns the one-time URL token; build the link client-side.
 */
tempop.post('/', async (c) => {
	const user = c.get('user')!
	if (!(await hasTempopPermission(c.env, user, TEMPOP_CREATE_URN))) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	const body = await c.req.json().catch(() => null)
	const parsed = createSchema.safeParse(body)
	if (!parsed.success) {
		return c.json({ error: 'Invalid request body', issues: parsed.error.issues }, 400)
	}

	const ttlSeconds = resolveTempopTtlSeconds(parsed.data)
	if (ttlSeconds === null) {
		return c.json(
			{ error: 'Provide exactly one of ttlPreset (1h/4h/6h) or customHours (1-12)' },
			400
		)
	}

	const created = await createTempop(c.env, { creatorUserId: user.id, ttlSeconds })
	return c.json(
		{
			tempopId: created.id,
			shortCode: created.shortCode,
			token: created.token,
			expiresAt: created.expiresAt.toISOString(),
		},
		201
	)
})

/**
 * GET /api/mumble-tempop
 * List temp-ops with filters. Create-only callers are scoped to their own
 * rows; delete-any/admin callers may list all and filter by creator.
 */
tempop.get('/', async (c) => {
	const user = c.get('user')!
	const [canCreate, canDeleteAny] = await Promise.all([
		hasTempopPermission(c.env, user, TEMPOP_CREATE_URN),
		hasTempopPermission(c.env, user, TEMPOP_DELETE_URN),
	])
	if (!canCreate && !canDeleteAny) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	const parsed = listQuerySchema.safeParse(c.req.query())
	if (!parsed.success) {
		return c.json({ error: 'Invalid query', issues: parsed.error.issues }, 400)
	}
	const { status, creatorId, limit, offset } = parsed.data
	const mine = parsed.data.mine === 'true'

	const db = createDb(c.env.DATABASE_URL)
	const now = new Date()

	const conditions = []
	// Scope: create-only users are locked to their own temp-ops.
	if (!canDeleteAny) {
		conditions.push(eq(mumbleTempops.creatorUserId, user.id))
	} else if (mine) {
		conditions.push(eq(mumbleTempops.creatorUserId, user.id))
	} else if (creatorId) {
		conditions.push(eq(mumbleTempops.creatorUserId, creatorId))
	}

	if (status === 'active') {
		conditions.push(eq(mumbleTempops.status, 'active'))
		conditions.push(gt(mumbleTempops.expiresAt, now))
	} else if (status === 'expired') {
		const expiredCondition = or(
			eq(mumbleTempops.status, 'expired'),
			and(eq(mumbleTempops.status, 'active'), lte(mumbleTempops.expiresAt, now))
		)
		if (expiredCondition) conditions.push(expiredCondition)
	} else if (status === 'deleted') {
		conditions.push(eq(mumbleTempops.status, 'deleted'))
	}

	const whereClause = conditions.length > 0 ? and(...conditions) : undefined

	const rows = await db.query.mumbleTempops.findMany({
		where: whereClause,
		orderBy: [desc(mumbleTempops.createdAt)],
		limit,
		offset,
	})

	// Live active-guest counts for the listed temp-ops.
	const tempopIds = rows.map((row) => row.id)
	const guestCounts = new Map<string, number>()
	if (tempopIds.length > 0) {
		const guests = await db.query.mumbleTempopGuests.findMany({
			where: and(
				inArray(mumbleTempopGuests.tempopId, tempopIds),
				eq(mumbleTempopGuests.status, 'active')
			),
			columns: { tempopId: true },
		})
		for (const guest of guests) {
			guestCounts.set(guest.tempopId, (guestCounts.get(guest.tempopId) ?? 0) + 1)
		}
	}

	const creatorNames = await resolveCreatorNames(db, [
		...new Set(rows.map((row) => row.creatorUserId)),
	])

	const items = rows.map((row) => {
		const effectiveStatus =
			row.status === 'active' && row.expiresAt.getTime() <= now.getTime()
				? 'expired'
				: row.status
		const isOwner = row.creatorUserId === user.id
		return {
			id: row.id,
			shortCode: row.shortCode,
			creatorUserId: row.creatorUserId,
			creatorName: creatorNames.get(row.creatorUserId) ?? null,
			groupName: row.groupName,
			ttlSeconds: row.ttlSeconds,
			status: effectiveStatus,
			guestCount: guestCounts.get(row.id) ?? 0,
			createdAt: row.createdAt.toISOString(),
			expiresAt: row.expiresAt.toISOString(),
			deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
			canDelete: isOwner || user.is_admin || canDeleteAny,
		}
	})

	const creators = canDeleteAny
		? await listDistinctCreators(db)
		: [{ id: user.id, name: creatorNames.get(user.id) ?? null }]

	return c.json({ items, creators, limit, offset, hasMore: rows.length === limit })
})

/**
 * DELETE /api/mumble-tempop/:id
 * Delete a temp-op and disconnect all of its guests. Allowed for the owner,
 * site admins, or holders of urn:mumble:tempop:delete.
 */
tempop.delete('/:id', async (c) => {
	const user = c.get('user')!
	const id = c.req.param('id')
	if (!UUID_RE.test(id)) {
		return c.json({ error: 'Temp-op not found' }, 404)
	}

	const db = createDb(c.env.DATABASE_URL)
	const row = await db.query.mumbleTempops.findFirst({
		where: eq(mumbleTempops.id, id),
		columns: { id: true, creatorUserId: true },
	})
	if (!row) {
		return c.json({ error: 'Temp-op not found' }, 404)
	}

	const isOwner = row.creatorUserId === user.id
	const allowed =
		isOwner || user.is_admin || (await hasTempopPermission(c.env, user, TEMPOP_DELETE_URN))
	if (!allowed) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	const result = await deleteTempop(c.env, id, user.id)
	return c.json({ success: true, disconnected: result.disconnected })
})

export default tempop
