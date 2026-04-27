import { Hono } from 'hono'

import { and, desc, eq, ilike, inArray, or, sql } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

import { managedCorporations, userCharacters, users } from '../../db/schema'
import { isNpcCorporationId } from '../../lib/corporation-id'
import { getCachedUserPermissions } from '../../lib/groups-cache'
import { validateAndSyncCharacterTokenValidityBatch } from '../../lib/token-validity'
import { requireAdmin, requireAuth } from '../../middleware/session'
import corporationsDirectorsRoutes from './directors-routes'
import corporationsDiscordRoutes from './discord-routes'
import corporationsPermissionsRoutes from './permissions-routes'

import type { Context } from 'hono'
import type { EveCharacterData } from '@repo/eve-character-data'
import type { EveCorporationData } from '@repo/eve-corporation-data'
import type { EveTokenStore } from '@repo/eve-token-store'
import type { Groups } from '@repo/groups'
import type { Hr } from '@repo/hr'
import type { App } from '../../context'

const app = new Hono<App>()

/**
 * Cache duration for corporation member data (5 minutes)
 */
const CACHE_TTL = 5 * 60 // 5 minutes in seconds

/**
 * Helper to get cache instance
 */
function getCache() {
	// @ts-ignore
	return caches.default
}

/**
 * Helper to create cache key for corporation members
 */
function getCorpMembersCacheKey(corporationId: string): string {
	return `https://cache.local/corporations/${corporationId}/members`
}

type CorporationMemberListItem = {
	characterId: string
	characterName: string
	corporationId: string
	corporationName: string
	role: 'CEO' | 'Director' | 'Member'
	hasAuthAccount: boolean
	hasValidToken?: boolean | null
	authUserId?: string
	mainCharacterName?: string
	status?: 'active' | 'emeritus'
	joinDate: string
	lastEsiUpdate: string
	lastLogin?: string
	allianceId?: string
	allianceName?: string
	locationSystem?: string
	locationRegion?: string
	activityStatus: 'active' | 'inactive' | 'unknown'
	isBlacklisted: boolean
}

type MembersAuthFilter =
	| 'all'
	| 'linked'
	| 'unlinked'
	| 'linked_valid'
	| 'linked_invalid'
	| 'linked_unknown'
type MembersActivityFilter = 'all' | 'active' | 'inactive' | 'unknown'
type MembersRoleFilter = 'all' | 'CEO' | 'Director' | 'Member'
type MembersSortField = 'name' | 'role' | 'auth' | 'activity' | 'lastLogin' | 'joinDate'
type MembersSortOrder = 'asc' | 'desc'

type MembersQuery = {
	page: number
	limit: number
	search: string
	authFilter: MembersAuthFilter
	activityFilter: MembersActivityFilter
	roleFilter: MembersRoleFilter
	sortField: MembersSortField
	sortOrder: MembersSortOrder
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
	const parsed = Number.parseInt(value ?? '', 10)
	if (!Number.isFinite(parsed) || parsed < 1) {
		return fallback
	}
	return parsed
}

function parseMembersQuery(c: Context<App>): MembersQuery {
	const page = parsePositiveInt(c.req.query('page'), 1)
	const limit = Math.min(parsePositiveInt(c.req.query('limit'), 50), 200)
	const search = (c.req.query('search') ?? '').trim().toLowerCase()
	const authFilterRaw = c.req.query('authFilter')
	const activityFilterRaw = c.req.query('activityFilter')
	const roleFilterRaw = c.req.query('roleFilter')
	const sortFieldRaw = c.req.query('sortField')
	const sortOrderRaw = c.req.query('sortOrder')

	const authFilter: MembersAuthFilter =
		authFilterRaw === 'linked' ||
		authFilterRaw === 'unlinked' ||
		authFilterRaw === 'linked_valid' ||
		authFilterRaw === 'linked_invalid' ||
		authFilterRaw === 'linked_unknown'
			? authFilterRaw
			: 'all'
	const activityFilter: MembersActivityFilter =
		activityFilterRaw === 'active' || activityFilterRaw === 'inactive' || activityFilterRaw === 'unknown'
			? activityFilterRaw
			: 'all'
	const roleFilter: MembersRoleFilter =
		roleFilterRaw === 'CEO' || roleFilterRaw === 'Director' || roleFilterRaw === 'Member'
			? roleFilterRaw
			: 'all'
	const sortField: MembersSortField =
		sortFieldRaw === 'name' ||
			sortFieldRaw === 'role' ||
			sortFieldRaw === 'auth' ||
			sortFieldRaw === 'activity' ||
			sortFieldRaw === 'lastLogin' ||
			sortFieldRaw === 'joinDate'
			? sortFieldRaw
			: 'role'
	const sortOrder: MembersSortOrder = sortOrderRaw === 'desc' ? 'desc' : 'asc'

	return {
		page,
		limit,
		search,
		authFilter,
		activityFilter,
		roleFilter,
		sortField,
		sortOrder,
	}
}

function canUseBackendPaginatedMembersPath(query: MembersQuery): boolean {
	return (
		!query.search &&
		query.authFilter === 'all' &&
		query.activityFilter === 'all' &&
		query.roleFilter === 'all' &&
		query.sortField === 'role' &&
		query.sortOrder === 'asc'
	)
}

function filterSortAndPaginateMembers(members: CorporationMemberListItem[], query: MembersQuery) {
	const filtered = [...members]
		.filter((member) => {
			if (!query.search) return true
			return (
				member.characterName.toLowerCase().includes(query.search) ||
				member.mainCharacterName?.toLowerCase().includes(query.search) ||
				member.locationSystem?.toLowerCase().includes(query.search)
			)
		})
		.filter((member) => {
			if (query.authFilter === 'all') return true
			if (query.authFilter === 'linked') return member.hasAuthAccount
			if (query.authFilter === 'unlinked') return !member.hasAuthAccount
			if (query.authFilter === 'linked_valid') {
				return member.hasAuthAccount && member.hasValidToken === true
			}
			if (query.authFilter === 'linked_invalid') {
				return member.hasAuthAccount && member.hasValidToken === false
			}
			if (query.authFilter === 'linked_unknown') {
				return member.hasAuthAccount && member.hasValidToken !== true && member.hasValidToken !== false
			}
			return true
		})
		.filter((member) => {
			if (query.activityFilter === 'all') return true
			return member.activityStatus === query.activityFilter
		})
		.filter((member) => {
			if (query.roleFilter === 'all') return true
			return member.role === query.roleFilter
		})

	filtered.sort((a, b) => {
		let comparison = 0
		switch (query.sortField) {
			case 'name':
				comparison = a.characterName.localeCompare(b.characterName)
				break
			case 'role': {
				const roleOrder = { CEO: 0, Director: 1, Member: 2 }
				comparison = roleOrder[a.role] - roleOrder[b.role]
				if (comparison === 0) {
					comparison = a.characterName.localeCompare(b.characterName)
				}
				break
			}
			case 'auth':
				comparison = (a.hasAuthAccount ? 0 : 1) - (b.hasAuthAccount ? 0 : 1)
				break
			case 'activity': {
				const activityOrder = { active: 0, inactive: 1, unknown: 2 }
				comparison = activityOrder[a.activityStatus] - activityOrder[b.activityStatus]
				break
			}
			case 'lastLogin':
				comparison = (b.lastLogin || '').localeCompare(a.lastLogin || '')
				break
			case 'joinDate':
				comparison = a.joinDate.localeCompare(b.joinDate)
				break
		}
		return query.sortOrder === 'asc' ? comparison : -comparison
	})

	const totalItems = filtered.length
	const totalPages = Math.max(1, Math.ceil(totalItems / query.limit))
	const currentPage = Math.min(query.page, totalPages)
	const start = (currentPage - 1) * query.limit
	const items = filtered.slice(start, start + query.limit)

	return {
		items,
		pagination: {
			page: currentPage,
			limit: query.limit,
			totalItems,
			totalPages,
			hasNextPage: currentPage < totalPages,
			hasPreviousPage: currentPage > 1,
		},
		summary: {
			total: totalItems,
			linked: filtered.filter((m) => m.hasAuthAccount).length,
			active: filtered.filter((m) => m.activityStatus === 'active').length,
			inactive: filtered.filter((m) => m.activityStatus === 'inactive').length,
			directors: filtered.filter((m) => m.role === 'Director').length,
		},
	}
}

async function enrichMembersPageLiveTokenStatus(
	db: NonNullable<Context<App>['var']['db']>,
	tokenStore: EveTokenStore,
	response: ReturnType<typeof filterSortAndPaginateMembers>
) {
	const linkedPageItems = response.items.filter((item) => item.hasAuthAccount)
	if (linkedPageItems.length === 0) {
		return response
	}

	try {
		const liveTokenValidityByCharacterId = await validateAndSyncCharacterTokenValidityBatch({
			db,
			tokenStore,
			characters: linkedPageItems.map((item) => ({
				characterId: item.characterId,
				hasValidToken: item.hasValidToken ?? null,
			})),
			maxConcurrency: 20,
		})

		return {
			...response,
			items: response.items.map((item) => {
				if (!item.hasAuthAccount) {
					return item
				}
				const liveStatus = liveTokenValidityByCharacterId.get(item.characterId)
				if (liveStatus === undefined) {
					return item
				}
				return {
					...item,
					hasValidToken: liveStatus,
				}
			}),
		}
	} catch (error) {
		logger.warn('[Corporations] Failed live token status enrichment for member page', {
			error: error instanceof Error ? error.message : String(error),
			pageSize: response.items.length,
		})
		return response
	}
}

/**
 * Helper to check cache for JSON response
 */
async function getCachedJson<T>(cacheKey: string): Promise<T | null> {
	try {
		const cache = getCache()
		const cachedResponse = await cache.match(cacheKey)
		if (cachedResponse) {
			const age = cachedResponse.headers.get('age')
			logger.info('[Cache] Hit', { cacheKey, age: age ? `${age}s` : 'unknown' })
			return await cachedResponse.json()
		}
		logger.info('[Cache] Miss', { cacheKey })
		return null
	} catch (error) {
		logger.warn('[Cache] Error reading cache', {
			cacheKey,
			error: error instanceof Error ? error.message : String(error),
		})
		return null
	}
}

/**
 * Helper to store JSON response in cache
 */
async function cacheJson(cacheKey: string, data: unknown, ttl: number): Promise<void> {
	try {
		const cache = getCache()
		const response = new Response(JSON.stringify(data), {
			headers: {
				'Content-Type': 'application/json',
				'Cache-Control': `public, max-age=${ttl}`,
			},
		})
		await cache.put(cacheKey, response)
		logger.info('[Cache] Stored', { cacheKey, ttl })
	} catch (error) {
		logger.warn('[Cache] Error storing cache', {
			cacheKey,
			error: error instanceof Error ? error.message : String(error),
		})
	}
}

/**
 * Check if the current user has CEO, director, or site admin access to a corporation
 * @returns Object with hasAccess flag and role if access granted
 * @throws Error with 403 status if user has no access
 */
async function checkCorporationAccess(
	c: Context<App>,
	corporationId: string
): Promise<{ hasAccess: true; role: 'admin' | 'CEO' | 'Director' }> {
	const user = c.get('user')!
	const db = c.get('db')

	if (!db) {
		throw new Error('Database not available')
	}

	// Site admins have access to all corporations
	if (user.is_admin) {
		logger.info('[Corporation Access] Admin access granted', {
			corporationId,
			userId: user.id,
			reason: 'site_admin',
		})
		return { hasAccess: true, role: 'admin' }
	}

	// Get user's characters to check CEO/Director status
	const userChars = await db.query.userCharacters.findMany({
		where: eq(userCharacters.userId, user.id),
	})

	logger.info('[Corporation Access] Checking user access', {
		corporationId,
		userId: user.id,
		userCharacterCount: userChars.length,
	})

	let userRole: 'CEO' | 'Director' | null = null

	for (const character of userChars) {
		try {
			// Check if character is in this corporation
			const charStub = getStub<EveCharacterData>(c.env.EVE_CHARACTER_DATA, character.characterId)
			const charData = await charStub.getCharacterInfo(character.characterId)

			// Skip if character is not in the target corporation
			if (!charData || String(charData.corporationId) !== corporationId) {
				continue
			}

			// Get corporation data to check CEO and directors
			const corpStub = getStub<EveCorporationData>(c.env.EVE_CORPORATION_DATA, corporationId)
			const [corpInfo, directors] = await Promise.all([
				corpStub.getCorporationInfo(corporationId),
				corpStub.getDirectors(corporationId),
			])

			// Check if character is CEO
			const isCeo = corpInfo && String(corpInfo.ceoId) === character.characterId
			if (isCeo) {
				userRole = 'CEO'
				logger.info('[Corporation Access] CEO access granted', {
					characterId: character.characterId,
					characterName: character.characterName,
					corporationId,
					reason: 'corporation_ceo',
				})
				return { hasAccess: true, role: 'CEO' }
			}

			// Check if character is a director
			const matchedDirector = directors.find((d) => d.characterId === character.characterId)
			if (matchedDirector) {
				userRole = 'Director'
				logger.info('[Corporation Access] Director access granted', {
					characterId: character.characterId,
					characterName: character.characterName,
					corporationId,
					reason: 'corporation_director',
				})
				// Continue checking in case another character is CEO
			}
		} catch (error) {
			logger.warn('[Corporation Access] Error checking character access:', {
				characterId: character.characterId,
				corporationId,
				error: error instanceof Error ? error.message : String(error),
			})
		}
	}

	// If we found a Director role, return it
	if (userRole === 'Director') {
		return { hasAccess: true, role: 'Director' }
	}

	// No access found
	logger.warn('[Corporation Access] Access denied', {
		corporationId,
		userId: user.id,
		isAdmin: user.is_admin,
		checkedCharacters: userChars.length,
	})

	throw new Error('Access denied. Corporation CEO, Director, or site admin access required.')
}

async function isHrAuditorUser(c: Context<App>): Promise<boolean> {
	const user = c.get('user')!
	if (user.is_admin) return true
	const permissions = await getCachedUserPermissions(c.env, user.id)
	return permissions.some((p) => p.urn === 'urn:hr:auditor')
}

/**
 * GET /corporations
 * List all configured corporations (admin only)
 *
 * Query parameters:
 *   isMember: boolean - filter by member corporation status
 *   isAlt: boolean - filter by alt corporation status
 */
app.get('/', requireAuth(), requireAdmin(), async (c) => {
	const db = c.get('db')

	if (!db) {
		return c.json({ error: 'Database not available' }, 500)
	}

	try {
		const corporationType = c.req.query('corporationType') as
			| 'member'
			| 'alt'
			| 'special'
			| 'other'
			| undefined

		// Build where conditions based on corporation type
		let whereCondition
		if (corporationType === 'member') {
			whereCondition = eq(managedCorporations.isMemberCorporation, true)
		} else if (corporationType === 'alt') {
			whereCondition = eq(managedCorporations.isAltCorp, true)
		} else if (corporationType === 'special') {
			whereCondition = eq(managedCorporations.isSpecialPurpose, true)
		} else if (corporationType === 'other') {
			// "Other" corporations are those that are not member, alt, or special purpose
			whereCondition = and(
				eq(managedCorporations.isMemberCorporation, false),
				eq(managedCorporations.isAltCorp, false),
				eq(managedCorporations.isSpecialPurpose, false)
			)
		}
		// If corporationType is undefined, no filter (show all)

		const corporations = await db.query.managedCorporations.findMany({
			where: whereCondition,
			orderBy: desc(managedCorporations.updatedAt),
		})

		// Safety filter: never expose NPC corporations as managed corporations in admin views.
		return c.json(corporations.filter((corp) => !isNpcCorporationId(corp.corporationId)))
	} catch (error) {
		logger.error('Error fetching corporations:', error)
		return c.json({ error: 'Failed to fetch corporations' }, 500)
	}
})

/**
 * GET /corporations/search?q=:query
 * Search corporations by name or ticker
 */
app.get('/search', requireAuth(), requireAdmin(), async (c) => {
	const query = c.req.query('q')
	const db = c.get('db')

	if (!db) {
		return c.json({ error: 'Database not available' }, 500)
	}

	if (!query || query.length < 2) {
		return c.json({ error: 'Query must be at least 2 characters' }, 400)
	}

	try {
		// Search in both managed corporations and ESI
		const results = await db
			.select()
			.from(managedCorporations)
			.where(
				or(
					ilike(managedCorporations.name, `%${query}%`),
					ilike(managedCorporations.ticker, `%${query}%`)
				)
			)
			.limit(20)

		return c.json(results)
	} catch (error) {
		logger.error('Error searching corporations:', error)
		return c.json({ error: 'Failed to search corporations' }, 500)
	}
})

/**
 * GET /corporations/browse
 * List member corporations for public browsing (authenticated users only, not admin-only)
 * Returns only corporations where isMemberCorporation = true AND isRecruiting = true
 */
app.get('/browse', requireAuth(), async (c) => {
	const db = c.get('db')

	if (!db) {
		return c.json({ error: 'Database not available' }, 500)
	}

	try {
		// Only return recruiting member corporations
		const corporations = await db.query.managedCorporations.findMany({
			where: and(
				eq(managedCorporations.isMemberCorporation, true),
				eq(managedCorporations.isRecruiting, true)
			),
			orderBy: desc(managedCorporations.updatedAt),
		})

		return c.json(corporations)
	} catch (error) {
		logger.error('Error fetching member corporations:', error)
		return c.json({ error: 'Failed to fetch member corporations' }, 500)
	}
})

/**
 * GET /corporations/browse/search?q=:query
 * Search member corporations by name or ticker (authenticated users only, not admin-only)
 * Returns only corporations where isMemberCorporation = true AND isRecruiting = true
 */
app.get('/browse/search', requireAuth(), async (c) => {
	const query = c.req.query('q')
	const db = c.get('db')

	if (!db) {
		return c.json({ error: 'Database not available' }, 500)
	}

	if (!query || query.length < 2) {
		return c.json({ error: 'Query must be at least 2 characters' }, 400)
	}

	try {
		// Search only in recruiting member corporations
		const results = await db
			.select()
			.from(managedCorporations)
			.where(
				and(
					eq(managedCorporations.isMemberCorporation, true),
					eq(managedCorporations.isRecruiting, true),
					or(
						ilike(managedCorporations.name, `%${query}%`),
						ilike(managedCorporations.ticker, `%${query}%`)
					)
				)
			)
			.limit(20)

		return c.json(results)
	} catch (error) {
		logger.error('Error searching member corporations:', error)
		return c.json({ error: 'Failed to search member corporations' }, 500)
	}
})

/**
 * GET /corporations/browse/:corporationId
 * Get detailed information about a specific corporation for the detail page
 * Returns full corporation details including description and application instructions
 * CEOs, Directors, and site admins can access their corporation even if not recruiting
 */
app.get('/browse/:corporationId', requireAuth(), async (c) => {
	const corporationId = c.req.param('corporationId')
	const user = c.get('user')!
	const db = c.get('db')

	if (!db) {
		return c.json({ error: 'Database not available' }, 500)
	}

	try {
		// First, check if user has management access (CEO/Director/admin)
		let hasManagementAccess = false
		try {
			await checkCorporationAccess(c, corporationId)
			hasManagementAccess = true
		} catch {
			// CEO/Director/Admin check failed — fall back to HR role check
			const hr = getStub<Hr>(c.env.HR, 'default')
			const hasHrRole = await hr.checkPermission(user.id, corporationId, 'hr_viewer')
			if (hasHrRole) {
				hasManagementAccess = true
			}
		}

		// Get corporation - include non-recruiting if user has management access
		const corporation = await db.query.managedCorporations.findFirst({
			where: hasManagementAccess
				? eq(managedCorporations.corporationId, corporationId)
				: and(
					eq(managedCorporations.corporationId, corporationId),
					eq(managedCorporations.isRecruiting, true)
				),
		})

		if (!corporation) {
			return c.json({ error: 'Corporation not found or not recruiting' }, 404)
		}

		// Return corporation details
		return c.json(corporation)
	} catch (error) {
		logger.error('Error fetching corporation details:', error)
		return c.json({ error: 'Failed to fetch corporation details' }, 500)
	}
})

/**
 * PATCH /:corporationId/settings
 * Update corporation recruiting settings (CEO, admin, or HR admin)
 * Updates isRecruiting, shortDescription, and fullDescription fields
 */
app.patch('/:corporationId/settings', requireAuth(), async (c) => {
	const user = c.get('user')!
	const corporationId = c.req.param('corporationId')
	const db = c.get('db')

	if (!db) {
		return c.json({ error: 'Database not available' }, 500)
	}

	// Authorization check - user must be CEO, site admin, or HR admin
	try {
		await checkCorporationAccess(c, corporationId)
	} catch {
		// CEO/Director/Admin check failed — fall back to HR admin check
		const hr = getStub<Hr>(c.env.HR, 'default')
		const hasHrAdmin = await hr.checkPermission(user.id, corporationId, 'hr_admin')
		if (!hasHrAdmin) {
			return c.json({ error: 'Access denied. Corporation CEO, site admin, or HR admin required.' }, 403)
		}
	}

	// Parse and validate request body
	const body = await c.req.json()
	const { isRecruiting, shortDescription, fullDescription } = body

	logger.info('[Corporations] Request body parsed', {
		corporationId,
		userId: user.id,
		body,
	})

	// Validate short description length
	if (
		shortDescription !== undefined &&
		typeof shortDescription === 'string' &&
		shortDescription.length > 250
	) {
		return c.json({ error: 'Short description must not exceed 250 characters' }, 400)
	}
	logger.info('[Corporations] Short description length validated', {
		corporationId,
		userId: user.id,
		shortDescription,
	})

	try {
		// Build update object with only provided fields
		const updateData: Record<string, any> = {
			updatedAt: new Date(),
		}

		if (isRecruiting !== undefined) {
			updateData.isRecruiting = isRecruiting
			logger.info('[Corporations] isRecruiting updated', {
				corporationId,
				userId: user.id,
				isRecruiting,
			})
		}
		if (shortDescription !== undefined) {
			updateData.shortDescription = shortDescription || null
			logger.info('[Corporations] shortDescription updated', {
				corporationId,
				userId: user.id,
				shortDescription,
			})
		}
		if (fullDescription !== undefined) {
			updateData.fullDescription = fullDescription || null
			logger.info('[Corporations] fullDescription updated', {
				corporationId,
				userId: user.id,
				fullDescription,
			})
		}

		// Update corporation

		const [updatedCorporation] = await db
			.update(managedCorporations)
			.set(updateData)
			.where(eq(managedCorporations.corporationId, corporationId))
			.returning()

		logger.info('[Corporations] Settings updated', {
			corporationId,
			updatedBy: user.id,
			fields: Object.keys(updateData).filter((k) => k !== 'updatedAt'),
		})

		return c.json(updatedCorporation)
	} catch (error) {
		logger.error('[Corporations] Failed to update settings', {
			corporationId,
			error: error instanceof Error ? error.message : String(error),
		})
		return c.json({ error: 'Failed to update corporation settings' }, 500)
	}
})

/**
 * POST /corporations
 * Add a new corporation for management
 *
 * Body: {
 *   corporationId: string
 *   name: string
 *   ticker: string
 *   assignedCharacterId?: string
 *   assignedCharacterName?: string
 * }
 */
app.post('/', requireAuth(), requireAdmin(), async (c) => {
	const db = c.get('db')
	const user = c.get('user')!

	if (!db) {
		return c.json({ error: 'Database not available' }, 500)
	}

	try {
		const body = await c.req.json()
		const {
			corporationId,
			name,
			ticker,
			assignedCharacterId,
			assignedCharacterName,
			includeInBackgroundRefresh,
		} = body

		if (!corporationId || !name || !ticker) {
			return c.json({ error: 'corporationId, name, and ticker are required' }, 400)
		}
		if (isNpcCorporationId(corporationId)) {
			return c.json({ error: 'NPC corporations cannot be managed' }, 400)
		}

		// Check if corporation already exists
		const existing = await db.query.managedCorporations.findFirst({
			where: eq(managedCorporations.corporationId, corporationId),
		})

		if (existing) {
			return c.json({ error: 'Corporation already configured' }, 409)
		}

		// Insert new corporation
		const [corporation] = await db
			.insert(managedCorporations)
			.values({
				corporationId,
				name,
				ticker,
				assignedCharacterId: assignedCharacterId || null,
				assignedCharacterName: assignedCharacterName || null,
				isActive: true,
				includeInBackgroundRefresh: includeInBackgroundRefresh ?? false,
				isVerified: false,
				configuredBy: user.id,
			})
			.returning()

		// Configure the Durable Object
		try {
			const stub = getStub<EveCorporationData>(c.env.EVE_CORPORATION_DATA, corporationId)

			// Set character if assigned
			if (assignedCharacterId && assignedCharacterName) {
				logger.info('[Corporations] Setting character in DO', {
					corporationId,
					assignedCharacterId,
					assignedCharacterName,
				})
				await stub.setCharacter(corporationId, assignedCharacterId, assignedCharacterName)
				logger.info('[Corporations] Character set in DO successfully', { corporationId })
			}

			// Sync includeInBackgroundRefresh setting
			if (includeInBackgroundRefresh !== undefined) {
				await stub.updateCorporationConfig(corporationId, { includeInBackgroundRefresh })
				logger.info('[Corporations] Synced includeInBackgroundRefresh to eve-corporation-data', {
					corporationId,
					includeInBackgroundRefresh,
				})
			}
		} catch (error) {
			logger.error('[Corporations] Error configuring corporation DO', {
				corporationId,
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
			})
			// Don't fail the request, just log the error
		}

		return c.json(corporation, 201)
	} catch (error) {
		logger.error('Error adding corporation:', error)
		return c.json({ error: 'Failed to add corporation' }, 500)
	}
})

/**
 * GET /corporations/:corporationId
 * Get detailed corporation information
 */
app.get('/:corporationId', requireAuth(), requireAdmin(), async (c) => {
	const corporationId = c.req.param('corporationId')
	const db = c.get('db')

	if (!db) {
		return c.json({ error: 'Database not available' }, 500)
	}

	try {
		if (isNpcCorporationId(corporationId)) {
			return c.json({ error: 'Corporation not found' }, 404)
		}

		const corporation = await db.query.managedCorporations.findFirst({
			where: eq(managedCorporations.corporationId, corporationId),
		})

		if (!corporation) {
			return c.json({ error: 'Corporation not found' }, 404)
		}

		// Get configuration from Durable Object if exists
		let doConfig = null
		try {
			const stub = getStub<EveCorporationData>(c.env.EVE_CORPORATION_DATA, corporationId)
			doConfig = await stub.getConfiguration()
		} catch (error) {
			logger.error('Error fetching DO config:', error)
		}

		return c.json({
			...corporation,
			doConfig,
		})
	} catch (error) {
		logger.error('Error fetching corporation:', error)
		return c.json({ error: 'Failed to fetch corporation' }, 500)
	}
})

/**
 * PUT /corporations/:corporationId
 * Update corporation configuration
 *
 * Body: {
 *   assignedCharacterId?: string
 *   assignedCharacterName?: string
 *   isActive?: boolean
 *   isMemberCorporation?: boolean
 *   isAltCorp?: boolean
 *   isSpecialPurpose?: boolean
 *   discordGuildId?: string | null
 *   discordGuildName?: string | null
 *   discordAutoInvite?: boolean
 * }
 */
app.put('/:corporationId', requireAuth(), requireAdmin(), async (c) => {
	const corporationId = c.req.param('corporationId')
	const db = c.get('db')

	if (!db) {
		return c.json({ error: 'Database not available' }, 500)
	}

	try {
		const body = await c.req.json()
		const {
			assignedCharacterId,
			assignedCharacterName,
			isActive,
			includeInBackgroundRefresh,
			isMemberCorporation,
			isAltCorp,
			isSpecialPurpose,
			discordGuildId,
			discordGuildName,
			discordAutoInvite,
		} = body

		// Check if corporation exists
		const existing = await db.query.managedCorporations.findFirst({
			where: eq(managedCorporations.corporationId, corporationId),
		})

		if (!existing) {
			return c.json({ error: 'Corporation not found' }, 404)
		}

		// Handle TEST alliance permission auto-attachment/detachment
		if (isMemberCorporation !== undefined && isMemberCorporation !== existing.isMemberCorporation) {
			const user = c.get('user')!
			const testAllianceUrn = 'urn:eve:alliance:test-alliance'

			try {
				const groupsStub = getStub<Groups>(c.env.GROUPS, 'default')

				if (isMemberCorporation) {
					// Corporation is being marked as a member corp - attach TEST alliance permission
					logger.info(
						'[Corporations] Marking as member corp - attaching TEST alliance permission',
						{
							corporationId,
							urn: testAllianceUrn,
						}
					)

					// First, get all permissions to find the TEST alliance permission ID
					const allPermissions = await groupsStub.listPermissions()
					const testAlliancePermission = allPermissions.find((p) => p.urn === testAllianceUrn)

					if (testAlliancePermission) {
						// Check if permission is already attached
						const existingPermissions = await groupsStub.listCorporationPermissions(corporationId)
						const alreadyAttached = existingPermissions.some(
							(cp) => cp.permission.urn === testAllianceUrn
						)

						if (!alreadyAttached) {
							// Attach the permission
							await groupsStub.attachPermissionToCorporation(
								{
									corporationId,
									permissionId: testAlliancePermission.id,
								},
								user.id
							)
							logger.info('[Corporations] TEST alliance permission attached', {
								corporationId,
								permissionId: testAlliancePermission.id,
							})
						} else {
							logger.info('[Corporations] TEST alliance permission already attached', {
								corporationId,
							})
						}
					} else {
						logger.warn('[Corporations] TEST alliance permission not found in system', {
							corporationId,
							urn: testAllianceUrn,
						})
					}
				} else {
					// Corporation is being unmarked as a member corp - detach TEST alliance permission
					logger.info(
						'[Corporations] Unmarking as member corp - detaching TEST alliance permission',
						{
							corporationId,
							urn: testAllianceUrn,
						}
					)

					// Get corporation permissions to find the one to remove
					const corpPermissions = await groupsStub.listCorporationPermissions(corporationId)
					const testAllianceCorpPermission = corpPermissions.find(
						(cp) => cp.permission.urn === testAllianceUrn
					)

					if (testAllianceCorpPermission) {
						// Remove the permission
						await groupsStub.removePermissionFromCorporation(testAllianceCorpPermission.id, user.id)
						logger.info('[Corporations] TEST alliance permission detached', {
							corporationId,
							corporationPermissionId: testAllianceCorpPermission.id,
						})
					} else {
						logger.info('[Corporations] TEST alliance permission was not attached', {
							corporationId,
						})
					}
				}
			} catch (error) {
				logger.error('[Corporations] Error managing TEST alliance permission', {
					corporationId,
					isMemberCorporation,
					error: error instanceof Error ? error.message : String(error),
				})
				// Continue with the update even if permission management fails
				// This ensures the corporation status is still updated
			}
		}

		// Update database
		const [updated] = await db
			.update(managedCorporations)
			.set({
				...(assignedCharacterId !== undefined && { assignedCharacterId }),
				...(assignedCharacterName !== undefined && { assignedCharacterName }),
				...(isActive !== undefined && { isActive }),
				...(includeInBackgroundRefresh !== undefined && { includeInBackgroundRefresh }),
				...(isMemberCorporation !== undefined && { isMemberCorporation }),
				...(isAltCorp !== undefined && { isAltCorp }),
				...(isSpecialPurpose !== undefined && { isSpecialPurpose }),
				...(discordGuildId !== undefined && { discordGuildId }),
				...(discordGuildName !== undefined && { discordGuildName }),
				...(discordAutoInvite !== undefined && { discordAutoInvite }),
				updatedAt: new Date(),
			})
			.where(eq(managedCorporations.corporationId, corporationId))
			.returning()

		// Update Durable Object if character assignment changed
		if (assignedCharacterId && assignedCharacterName) {
			try {
				logger.info('[Corporations] Updating character in DO', {
					corporationId,
					assignedCharacterId,
					assignedCharacterName,
				})
				const stub = getStub<EveCorporationData>(c.env.EVE_CORPORATION_DATA, corporationId)
				await stub.setCharacter(corporationId, assignedCharacterId, assignedCharacterName)
				logger.info('[Corporations] Character updated in DO successfully', { corporationId })
			} catch (error) {
				logger.error('[Corporations] Error updating corporation DO', {
					corporationId,
					error: error instanceof Error ? error.message : String(error),
					stack: error instanceof Error ? error.stack : undefined,
				})
			}
		}

		// Sync includeInBackgroundRefresh to eve-corporation-data DB
		if (includeInBackgroundRefresh !== undefined) {
			try {
				const stub = getStub<EveCorporationData>(c.env.EVE_CORPORATION_DATA, corporationId)
				await stub.updateCorporationConfig(corporationId, { includeInBackgroundRefresh })
				logger.info('[Corporations] Synced includeInBackgroundRefresh to eve-corporation-data', {
					corporationId,
					includeInBackgroundRefresh,
				})
			} catch (error) {
				logger.error('[Corporations] Failed to sync includeInBackgroundRefresh', {
					corporationId,
					error: error instanceof Error ? error.message : String(error),
				})
			}
		}

		return c.json(updated)
	} catch (error) {
		logger.error('Error updating corporation:', error)
		return c.json({ error: 'Failed to update corporation' }, 500)
	}
})

/**
 * DELETE /corporations/:corporationId
 * Remove a corporation from management
 */
app.delete('/:corporationId', requireAuth(), requireAdmin(), async (c) => {
	const corporationId = c.req.param('corporationId')
	const db = c.get('db')

	if (!db) {
		return c.json({ error: 'Database not available' }, 500)
	}

	try {
		await db.delete(managedCorporations).where(eq(managedCorporations.corporationId, corporationId))

		return c.json({ success: true })
	} catch (error) {
		logger.error('Error deleting corporation:', error)
		return c.json({ error: 'Failed to delete corporation' }, 500)
	}
})

/**
 * POST /corporations/:corporationId/verify
 * Verify director character access and roles
 */
app.post('/:corporationId/verify', requireAuth(), requireAdmin(), async (c) => {
	const corporationId = c.req.param('corporationId')
	const db = c.get('db')

	logger.info('[Corporations] Verify access request', { corporationId })

	if (!db) {
		logger.error('[Corporations] Database not available')
		return c.json({ error: 'Database not available' }, 500)
	}

	try {
		// Verify access via Durable Object
		logger.info('[Corporations] Getting DO stub', { corporationId, stubId: corporationId })
		const stub = getStub<EveCorporationData>(c.env.EVE_CORPORATION_DATA, corporationId)

		logger.info('[Corporations] Calling verifyAccess on DO', { corporationId })
		const verification = await stub.verifyAccess()

		logger.info('[Corporations] Verification result received', {
			corporationId,
			hasAccess: verification.hasAccess,
			characterId: verification.characterId,
			rolesCount: verification.verifiedRoles.length,
			roles: verification.verifiedRoles,
		})

		// Update database with verification result
		logger.info('[Corporations] Updating database with verification result', { corporationId })
		await db
			.update(managedCorporations)
			.set({
				isVerified: verification.hasAccess,
				lastVerified: verification.lastVerified || new Date(),
				updatedAt: new Date(),
			})
			.where(eq(managedCorporations.corporationId, corporationId))

		logger.info('[Corporations] Verification complete', {
			corporationId,
			hasAccess: verification.hasAccess,
			missingRoles: verification.missingRoles,
		})

		return c.json(verification)
	} catch (error) {
		logger.error('[Corporations] Error verifying corporation access', {
			corporationId,
			error: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : undefined,
		})
		return c.json({ error: 'Failed to verify access' }, 500)
	}
})

/**
 * POST /corporations/:corporationId/fetch
 * Trigger data fetch for corporation
 *
 * Body: {
 *   category?: 'all' | 'public' | 'core' | 'financial' | 'assets' | 'market' | 'killmails'
 *   forceRefresh?: boolean
 * }
 */
app.post('/:corporationId/fetch', requireAuth(), requireAdmin(), async (c) => {
	const corporationId = c.req.param('corporationId')
	const db = c.get('db')

	logger.info('[Corporations] Fetch data request', { corporationId })

	if (!db) {
		logger.error('[Corporations] Database not available for fetch')
		return c.json({ error: 'Database not available' }, 500)
	}

	try {
		const body = await c.req.json()
		const { category = 'all', forceRefresh = false } = body

		logger.info('[Corporations] Fetch parameters', { corporationId, category, forceRefresh })

		// Fetch data via Durable Object
		logger.info('[Corporations] Getting DO stub for fetch', {
			corporationId,
			stubId: corporationId,
		})
		const stub = getStub<EveCorporationData>(c.env.EVE_CORPORATION_DATA, corporationId)

		logger.info('[Corporations] Calling fetch method on DO', { corporationId, category })

		switch (category) {
			case 'public':
				logger.info('[Corporations] Fetching public data', { corporationId })
				await stub.fetchPublicData(corporationId, forceRefresh)
				break
			case 'core':
				logger.info('[Corporations] Fetching core data', { corporationId })
				await stub.fetchCoreData(corporationId, forceRefresh)
				break
			case 'financial':
				logger.info('[Corporations] Fetching financial data', { corporationId })
				await stub.fetchFinancialData(corporationId, undefined, forceRefresh)
				break
			case 'assets':
				logger.warn('[Corporations] Assets fetch is temporarily disabled', { corporationId })
				return c.json(
					{
						error: 'Assets fetch is temporarily disabled',
						category: 'assets',
					},
					409
				)
			case 'market':
				logger.info('[Corporations] Fetching market data', { corporationId })
				await stub.fetchMarketData(corporationId, forceRefresh)
				break
			case 'killmails':
				logger.info('[Corporations] Fetching killmails', { corporationId })
				await stub.fetchKillmails(corporationId, forceRefresh)
				break
			case 'all':
			default:
				logger.info('[Corporations] Fetching all corporation data', { corporationId })
				await stub.fetchAllCorporationData(corporationId, forceRefresh)
				break
		}

		logger.info('[Corporations] Data fetch completed, updating last sync timestamp', {
			corporationId,
		})

		// Update last sync timestamp
		await db
			.update(managedCorporations)
			.set({
				lastSync: new Date(),
				updatedAt: new Date(),
			})
			.where(eq(managedCorporations.corporationId, corporationId))

		logger.info('[Corporations] Fetch successful', { corporationId, category })
		return c.json({ success: true, category })
	} catch (error) {
		logger.error('[Corporations] Error fetching corporation data', {
			corporationId,
			error: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : undefined,
		})
		return c.json({ error: 'Failed to fetch data' }, 500)
	}
})

/**
 * GET /corporations/:corporationId/data
 * Get summary of fetched corporation data
 */
app.get('/:corporationId/data', requireAuth(), requireAdmin(), async (c) => {
	const corporationId = c.req.param('corporationId')

	logger.info('[Corporations] Get data summary request', { corporationId })

	try {
		logger.info('[Corporations] Getting DO stub for data summary', {
			corporationId,
			stubId: corporationId,
		})
		const stub = getStub<EveCorporationData>(c.env.EVE_CORPORATION_DATA, corporationId)

		logger.info('[Corporations] Fetching all data from DO', { corporationId })
		const [publicInfo, coreData, financialData, assetsData, marketData, killmails] =
			await Promise.all([
				stub.getCorporationInfo(corporationId).catch((e: unknown) => {
					logger.error('[Corporations] getCorporationInfo failed', {
						corporationId,
						error: e instanceof Error ? e.message : String(e),
						stack: e instanceof Error ? e.stack : undefined,
					})
					return null
				}),
				stub.getCoreData(corporationId).catch((e: unknown) => {
					logger.error('[Corporations] getCoreData failed', {
						corporationId,
						error: e instanceof Error ? e.message : String(e),
						stack: e instanceof Error ? e.stack : undefined,
					})
					return null
				}),
				stub.getFinancialData(corporationId).catch((e: unknown) => {
					logger.error('[Corporations] getFinancialData failed', {
						corporationId,
						error: e instanceof Error ? e.message : String(e),
						stack: e instanceof Error ? e.stack : undefined,
					})
					return null
				}),
				stub.getAssetsData(corporationId).catch((e: unknown) => {
					logger.error('[Corporations] getAssetsData failed', {
						corporationId,
						error: e instanceof Error ? e.message : String(e),
						stack: e instanceof Error ? e.stack : undefined,
					})
					return null
				}),
				stub.getMarketData(corporationId).catch((e: unknown) => {
					logger.error('[Corporations] getMarketData failed', {
						corporationId,
						error: e instanceof Error ? e.message : String(e),
						stack: e instanceof Error ? e.stack : undefined,
					})
					return null
				}),
				stub.getKillmails(corporationId, 10).catch((e: unknown) => {
					logger.error('[Corporations] getKillmails failed', {
						corporationId,
						error: e instanceof Error ? e.message : String(e),
						stack: e instanceof Error ? e.stack : undefined,
					})
					return []
				}),
			])

		logger.info('[Corporations] Data fetched successfully', {
			corporationId,
			hasPublicInfo: !!publicInfo,
			hasCoreData: !!coreData,
			hasFinancialData: !!financialData,
			hasAssetsData: !!assetsData,
			hasMarketData: !!marketData,
			killmailsCount: killmails.length,
		})

		const responseData = {
			publicInfo,
			coreData: coreData
				? {
					memberCount: coreData.members.length,
					trackingCount: coreData.memberTracking.length,
				}
				: null,
			financialData: financialData
				? {
					walletCount: financialData.wallets.length,
					journalCount: financialData.journalEntries.length,
					transactionCount: financialData.transactions.length,
				}
				: null,
			assetsData: assetsData
				? {
					assetCount: assetsData.assets.length,
					structureCount: assetsData.structures.length,
				}
				: null,
			marketData: marketData
				? {
					orderCount: marketData.orders.length,
					contractCount: marketData.contracts.length,
					industryJobCount: marketData.industryJobs.length,
				}
				: null,
			killmailCount: killmails.length,
		}

		return c.json(responseData)
	} catch (error) {
		logger.error('[Corporations] Error fetching corporation data summary', {
			corporationId,
			error: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : undefined,
		})
		return c.json({ error: 'Failed to fetch data summary' }, 500)
	}
})

/**
 * GET /corporations/:corporationId/members
 * Get all members of a corporation (requires CEO/director access)
 *
 * Returns comprehensive member data including auth link status
 */
app.get('/:corporationId/members', requireAuth(), async (c) => {
	const corporationId = c.req.param('corporationId')
	const query = parseMembersQuery(c)
	const user = c.get('user')!
	const db = c.get('db')

	if (!db) {
		return c.json({ error: 'Database not available' }, 500)
	}

	logger.info('[Corporations] Get members request', { corporationId, userId: user.id })

	try {
		// Check if corporation is managed
		const managedCorp = await db.query.managedCorporations.findFirst({
			where: and(
				eq(managedCorporations.corporationId, corporationId),
				eq(managedCorporations.isActive, true)
			),
		})

		if (!managedCorp) {
			return c.json({ error: 'Corporation not found or not managed' }, 404)
		}

		// Check if user has CEO/Director/Admin access, an HR role, or HR auditor permission
		let userRole: 'admin' | 'CEO' | 'Director' | 'hr_admin' | 'hr_reviewer' | 'hr_viewer'
		try {
			const access = await checkCorporationAccess(c, corporationId)
			userRole = access.role
		} catch {
			// CEO/Director/Admin check failed — fall back to HR role / auditor check
			const hr = getStub<Hr>(c.env.HR, 'default')
			const hasHrAccess = await hr.checkPermission(user.id, corporationId, 'hr_viewer')
			const isAuditor = !hasHrAccess && await isHrAuditorUser(c)
			if (!hasHrAccess && !isAuditor) {
				return c.json(
					{ error: 'Access denied. Corporation CEO, Director, site admin, HR role, or HR auditor permission required.' },
					403
				)
			}
			if (isAuditor) {
				userRole = 'hr_viewer'
			} else {
				// Determine the specific HR role for logging
				const isHrAdmin = await hr.checkPermission(user.id, corporationId, 'hr_admin')
				const isHrReviewer = !isHrAdmin && await hr.checkPermission(user.id, corporationId, 'hr_reviewer')
				userRole = isHrAdmin ? 'hr_admin' : isHrReviewer ? 'hr_reviewer' : 'hr_viewer'
			}
		}

		logger.info('[Corporations] User has access', { corporationId, userId: user.id, userRole })

		// Check cache for member data
		const cacheKey = getCorpMembersCacheKey(corporationId)
		const cached = await getCachedJson<CorporationMemberListItem[]>(cacheKey)
		const corpStub = getStub<EveCorporationData>(c.env.EVE_CORPORATION_DATA, corporationId)
		const tokenStoreStub = getStub<EveTokenStore>(c.env.EVE_TOKEN_STORE, 'default')

		const useBackendPagination =
			canUseBackendPaginatedMembersPath(query) &&
			typeof (corpStub as unknown as { getMembersPaginated?: unknown }).getMembersPaginated ===
				'function'

		if (useBackendPagination) {
			const paged = await (
				corpStub as unknown as {
					getMembersPaginated: (
						corporationId: string,
						page: number,
						limit: number
					) => Promise<{
						items: Array<{
							characterId: string
							role: 'CEO' | 'Director' | 'Member'
							joinDate: Date | null
							lastLogin: Date | null
							lastEsiUpdate: Date
							activityStatus: 'active' | 'inactive' | 'unknown'
						}>
						pagination: {
							page: number
							limit: number
							totalItems: number
							totalPages: number
							hasNextPage: boolean
							hasPreviousPage: boolean
						}
						summary: {
							total: number
							active: number
							inactive: number
							directors: number
						}
					}>
				}
			).getMembersPaginated(corporationId, query.page, query.limit)

			const pageCharacterIds = paged.items.map((item) => item.characterId)
			const linkedCharacters =
				pageCharacterIds.length > 0
					? await db.query.userCharacters.findMany({
						where: inArray(userCharacters.characterId, pageCharacterIds),
					})
					: []
			const linkedCharacterMap = new Map(linkedCharacters.map((row) => [row.characterId, row]))
			const characterNameMap =
				pageCharacterIds.length > 0 ? await tokenStoreStub.resolveIds(pageCharacterIds) : {}

			const linkedUserIds = [...new Set(linkedCharacters.map((row) => row.userId))]
			const linkedUsers =
				linkedUserIds.length > 0
					? await db.query.users.findMany({
						where: inArray(users.id, linkedUserIds),
					})
					: []
			const mainCharacterIds = linkedUsers.map((u) => u.mainCharacterId)
			const mainCharacterNameMap =
				mainCharacterIds.length > 0 ? await tokenStoreStub.resolveIds(mainCharacterIds) : {}
			const userIdToMainCharacterName = new Map(
				linkedUsers.map((u) => [u.id, mainCharacterNameMap[u.mainCharacterId] || 'Unknown'])
			)

			const hrStub = getStub<Hr>(c.env.HR, 'default')
			const blacklistStatuses =
				pageCharacterIds.length > 0
					? await hrStub.checkCharactersBlacklisted(pageCharacterIds)
					: {}

			const pageMembers: CorporationMemberListItem[] = paged.items.map((item) => {
				const linkedChar = linkedCharacterMap.get(item.characterId)
				return {
					characterId: item.characterId,
					characterName: characterNameMap[item.characterId] || 'Unknown',
					corporationId,
					corporationName: managedCorp.name,
					role: item.role,
					hasAuthAccount: !!linkedChar,
					hasValidToken: linkedChar ? (linkedChar.hasValidToken ?? null) : null,
					authUserId: linkedChar?.userId,
					mainCharacterName: linkedChar?.userId
						? userIdToMainCharacterName.get(linkedChar.userId)
						: undefined,
					status: linkedChar?.status,
					joinDate: item.joinDate?.toISOString() || item.lastEsiUpdate.toISOString(),
					lastEsiUpdate: item.lastEsiUpdate.toISOString(),
					lastLogin: item.lastLogin?.toISOString(),
					allianceId: undefined,
					allianceName: undefined,
					locationSystem: undefined,
					locationRegion: undefined,
					activityStatus: item.activityStatus,
					isBlacklisted: blacklistStatuses[item.characterId] || false,
				}
			})

			const linkedSummaryRow = await db
				.select({
					count: sql<number>`count(*)`.as('count'),
				})
				.from(userCharacters)
				.where(eq(userCharacters.corporationId, corporationId))
				.then((rows) => rows[0] ?? { count: 0 })

			const enriched = await enrichMembersPageLiveTokenStatus(db, tokenStoreStub, {
				items: pageMembers,
				pagination: paged.pagination,
				summary: {
					total: paged.summary.total,
					linked: Number(linkedSummaryRow.count ?? 0),
					active: paged.summary.active,
					inactive: paged.summary.inactive,
					directors: paged.summary.directors,
				},
			})

			return c.json(enriched)
		}

		if (cached) {
			logger.info('[Corporations] Returning cached member data', {
				corporationId,
				memberCount: cached.length,
				page: query.page,
				limit: query.limit,
				search: query.search,
			})
			const paginated = filterSortAndPaginateMembers(cached, query)
			const enriched = await enrichMembersPageLiveTokenStatus(db, tokenStoreStub, paginated)
			return c.json(enriched)
		}

		// Get corporation members from DO
		const [corpInfo, coreData] = await Promise.all([
			corpStub.getCorporationInfo(corporationId),
			corpStub.getCoreData(corporationId),
		])

		if (!coreData || !coreData.members) {
			return c.json([])
		}

		// Collect all member character IDs first
		const memberCharacterIds = coreData.members.map((m) => String(m.characterId))

		// Batch query: only fetch linked characters for THIS corporation's members
		const linkedCharacters =
			memberCharacterIds.length > 0
				? await db.query.userCharacters.findMany({
					where: inArray(userCharacters.characterId, memberCharacterIds),
				})
				: []

		const linkedCharacterMap = new Map(linkedCharacters.map((c) => [c.characterId, c]))

		// Fetch directors list once for role determination
		const directors = await corpStub.getDirectors(corporationId)
		const directorIds = new Set(directors.map((d) => d.characterId))

		// Batch resolve all character names using ESI bulk endpoint
		// Character ID → name mappings are cached for 1 year (essentially permanent)
		const characterNameMap = await tokenStoreStub.resolveIds(memberCharacterIds)

		logger.info('[Corporations Members] Resolved character names', {
			corporationId,
			totalMembers: memberCharacterIds.length,
			resolvedCount: Object.keys(characterNameMap).length,
			unresolvedCount: memberCharacterIds.length - Object.keys(characterNameMap).length,
		})

		// Fetch user data to get main character IDs for linked accounts
		const linkedUserIds = [...new Set(linkedCharacters.map((c) => c.userId))]
		const linkedUsers =
			linkedUserIds.length > 0
				? await db.query.users.findMany({
					where: inArray(users.id, linkedUserIds),
				})
				: []

		// Resolve main character IDs to character names
		const mainCharacterIds = linkedUsers.map((u) => u.mainCharacterId)
		const mainCharacterNameMap =
			mainCharacterIds.length > 0 ? await tokenStoreStub.resolveIds(mainCharacterIds) : {}

		// Create a map from userId to main character name
		const userIdToMainCharacterName = new Map(
			linkedUsers.map((u) => [u.id, mainCharacterNameMap[u.mainCharacterId] || 'Unknown'])
		)

		logger.info('[Corporations Members] Resolved main character names for linked accounts', {
			corporationId,
			linkedAccountCount: linkedUserIds.length,
			resolvedMainCharacters: Object.keys(mainCharacterNameMap).length,
		})

		// Bulk check blacklist status for all members
		const hrStub = getStub<Hr>(c.env.HR, 'default')
		const blacklistStatuses =
			memberCharacterIds.length > 0
				? await hrStub.checkCharactersBlacklisted(memberCharacterIds)
				: {}

		// Process members with comprehensive data
		const membersWithDetails: CorporationMemberListItem[] = await Promise.all(
			coreData.members.map(async (member) => {
				const characterId = String(member.characterId)

				// Check auth link status using the map
				const linkedChar = linkedCharacterMap.get(characterId)
				const hasAuthAccount = !!linkedChar

				// Determine role using pre-fetched data
				let role: 'CEO' | 'Director' | 'Member' = 'Member'
				if (corpInfo && String(corpInfo.ceoId) === characterId) {
					role = 'CEO'
				} else if (directorIds.has(characterId)) {
					role = 'Director'
				}

				// Find member tracking data if available
				const tracking = coreData.memberTracking?.find((t) => t.characterId === characterId)

				// Get character name from resolved names (returns Record<string, string>)
				const characterName = characterNameMap[characterId] || 'Unknown'

				return {
					characterId,
					characterName,
					corporationId,
					corporationName: managedCorp.name,
					role,
					hasAuthAccount,
					hasValidToken: linkedChar ? (linkedChar.hasValidToken ?? null) : null,
					authUserId: linkedChar?.userId,
					mainCharacterName: linkedChar?.userId
						? userIdToMainCharacterName.get(linkedChar.userId)
						: undefined,
					status: linkedChar?.status,
					joinDate: tracking?.startDate?.toISOString() || member.updatedAt.toISOString(),
					lastEsiUpdate: member.updatedAt.toISOString(),
					lastLogin: tracking?.logonDate?.toISOString(),
					allianceId: corpInfo?.allianceId ? String(corpInfo.allianceId) : undefined,
					allianceName: undefined, // Not available in CorporationPublicData
					locationSystem: undefined, // Would need additional ESI scopes
					locationRegion: undefined, // Would need to be resolved from system ID
					activityStatus: tracking?.logonDate
						? new Date().getTime() - tracking.logonDate.getTime() < 7 * 24 * 60 * 60 * 1000
							? 'active'
							: 'inactive'
						: 'unknown',
					isBlacklisted: blacklistStatuses[characterId] || false,
				}
			})
		)

		// Sort by role (CEO first, then Directors, then Members), then by name
		membersWithDetails.sort((a, b) => {
			const roleOrder = { CEO: 0, Director: 1, Member: 2 }
			const roleDiff = roleOrder[a.role] - roleOrder[b.role]
			if (roleDiff !== 0) return roleDiff
			return a.characterName.localeCompare(b.characterName)
		})

		logger.info('[Corporations] Members fetched successfully', {
			corporationId,
			memberCount: membersWithDetails.length,
		})

		// Store in cache for future requests
		await cacheJson(cacheKey, membersWithDetails, CACHE_TTL)

		const paginated = filterSortAndPaginateMembers(membersWithDetails, query)
		const enriched = await enrichMembersPageLiveTokenStatus(db, tokenStoreStub, paginated)
		return c.json(enriched)
	} catch (error) {
		logger.error('[Corporations] Error fetching corporation members', {
			corporationId,
			error: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : undefined,
		})
		return c.json({ error: 'Failed to fetch corporation members' }, 500)
	}
})

/**
 * POST /corporations/:corporationId/members/refresh
 * Force refresh corporation core member data (requires CEO/director/admin access)
 */
app.post('/:corporationId/members/refresh', requireAuth(), async (c) => {
	const corporationId = c.req.param('corporationId')
	const user = c.get('user')!
	const db = c.get('db')

	if (!db) {
		return c.json({ error: 'Database not available' }, 500)
	}

	logger.info('[Corporations] Refresh members request', { corporationId, userId: user.id })

	try {
		// Check if corporation is managed
		const managedCorp = await db.query.managedCorporations.findFirst({
			where: and(
				eq(managedCorporations.corporationId, corporationId),
				eq(managedCorporations.isActive, true)
			),
		})

		if (!managedCorp) {
			return c.json({ error: 'Corporation not found or not managed' }, 404)
		}

		// Ensure user has CEO/Director/Admin access
		try {
			await checkCorporationAccess(c, corporationId)
		} catch (error) {
			return c.json({ error: error instanceof Error ? error.message : 'Access denied' }, 403)
		}

		// Trigger a forced refresh of core data (members + member tracking)
		const stub = getStub<EveCorporationData>(c.env.EVE_CORPORATION_DATA, corporationId)
		await stub.fetchCoreData(corporationId, true)

		// Invalidate member response cache so next GET returns fresh data immediately
		const cacheKey = getCorpMembersCacheKey(corporationId)
		try {
			await getCache().delete(cacheKey)
		} catch (cacheError) {
			logger.warn('[Corporations] Failed to invalidate members cache after refresh', {
				corporationId,
				cacheKey,
				error: cacheError instanceof Error ? cacheError.message : String(cacheError),
			})
		}

		// Update last sync timestamp for visibility in admin flows
		await db
			.update(managedCorporations)
			.set({
				lastSync: new Date(),
				updatedAt: new Date(),
			})
			.where(eq(managedCorporations.corporationId, corporationId))

		logger.info('[Corporations] Members refresh completed', { corporationId, userId: user.id })
		return c.json({ success: true })
	} catch (error) {
		logger.error('[Corporations] Error refreshing corporation members', {
			corporationId,
			userId: user.id,
			error: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : undefined,
		})
		return c.json({ error: 'Failed to refresh corporation members' }, 500)
	}
})

/**
 * PATCH /corporations/:corporationId/members/:characterId/status
 * Update a member's status (active/emeritus)
 * Requires CEO or admin access
 */
app.patch('/:corporationId/members/:characterId/status', requireAuth(), async (c) => {
	const corporationId = c.req.param('corporationId')
	const characterId = c.req.param('characterId')
	const user = c.get('user')!
	const db = c.get('db')

	if (!db) {
		return c.json({ error: 'Database not available' }, 500)
	}

	logger.info('[Corporations] Update member status request', {
		corporationId,
		characterId,
		userId: user.id,
	})

	try {
		// Parse and validate request body
		const body = await c.req.json()
		const status = body.status

		if (!status || (status !== 'active' && status !== 'emeritus')) {
			return c.json({ error: 'Invalid status. Must be "active" or "emeritus"' }, 400)
		}

		// Check if corporation is managed
		const managedCorp = await db.query.managedCorporations.findFirst({
			where: and(
				eq(managedCorporations.corporationId, corporationId),
				eq(managedCorporations.isActive, true)
			),
		})

		if (!managedCorp) {
			return c.json({ error: 'Corporation not found or not managed' }, 404)
		}

		// Check if user has CEO or Admin access (Directors cannot change status)
		let userRole: 'admin' | 'CEO' | 'Director'
		try {
			const access = await checkCorporationAccess(c, corporationId)
			userRole = access.role

			// Only CEO or admin can change status
			if (userRole !== 'CEO' && userRole !== 'admin') {
				return c.json({ error: 'Only CEOs and site admins can change member status' }, 403)
			}
		} catch (error) {
			return c.json({ error: error instanceof Error ? error.message : 'Access denied' }, 403)
		}

		// Get corporation info to check if character is CEO
		const corpStub = getStub<EveCorporationData>(c.env.EVE_CORPORATION_DATA, corporationId)
		const corpInfo = await corpStub.getCorporationInfo(corporationId)

		// Prevent marking CEO as emeritus
		if (corpInfo && String(corpInfo.ceoId) === characterId && status === 'emeritus') {
			return c.json(
				{ error: 'Cannot mark the corporation CEO as emeritus. Transfer CEO role first.' },
				400
			)
		}

		// Check if character exists in database and is in this corporation
		const character = await db.query.userCharacters.findFirst({
			where: eq(userCharacters.characterId, characterId),
		})

		if (!character) {
			return c.json({ error: 'Character not found in auth database' }, 404)
		}

		// Verify character is actually a member of this corporation
		const coreData = await corpStub.getCoreData(corporationId)
		const isMember = coreData?.members.some((m) => String(m.characterId) === characterId)

		if (!isMember) {
			return c.json({ error: 'Character is not a member of this corporation' }, 400)
		}

		// Update character status
		await db
			.update(userCharacters)
			.set({
				status,
				updatedAt: new Date(),
			})
			.where(eq(userCharacters.characterId, characterId))

		logger.info('[Corporations] Member status updated', {
			corporationId,
			characterId,
			characterName: character.characterName,
			newStatus: status,
			updatedBy: user.id,
			updatedByRole: userRole,
		})

		// Invalidate cache to force refresh of member list
		const cacheKey = getCorpMembersCacheKey(corporationId)
		try {
			await getCache().delete(cacheKey)
			logger.info('[Corporations] Invalidated members cache', { cacheKey })
		} catch (error) {
			logger.warn('[Corporations] Failed to invalidate cache', {
				cacheKey,
				error: error instanceof Error ? error.message : String(error),
			})
		}

		return c.json({
			success: true,
			characterId,
			characterName: character.characterName,
			status,
		})
	} catch (error) {
		logger.error('[Corporations] Error updating member status', {
			corporationId,
			characterId,
			error: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : undefined,
		})
		return c.json({ error: 'Failed to update member status' }, 500)
	}
})

app.route('/', corporationsDirectorsRoutes)
app.route('/', corporationsDiscordRoutes)
app.route('/', corporationsPermissionsRoutes)

export default app
