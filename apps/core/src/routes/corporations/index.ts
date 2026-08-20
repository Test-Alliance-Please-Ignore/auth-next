import { Hono } from 'hono'

import { and, asc, desc, eq, ilike, inArray, or, sql } from '@repo/db-utils'
import { getStub, withRpcResult } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'
import { buildCsvLine } from '@repo/worker-utils'

import { managedCorporations, userCharacters, users } from '../../db/schema'
import { isNpcCorporationId } from '../../lib/corporation-id'
import {
	clearCorporationListCache,
	clearCorporationStatusCache,
	clearCorporationSyncStatusCache,
	corporationDirectorStatusCache,
	corporationHealthCache,
	corporationListCache,
	corporationSyncStatusCache,
} from '../../lib/corporation-list-cache'
import { getCachedUserPermissions } from '../../lib/groups-cache'
import { requireAdmin, requireAuth } from '../../middleware/session'
import corporationsAlertsRoutes from './alerts-routes'
import corporationsDirectorsRoutes from './directors-routes'
import corporationsDiscordRoutes from './discord-routes'
import corporationsPermissionsRoutes from './permissions-routes'

import type { Context } from 'hono'
import type { Core } from '@repo/core'
import type { Discord } from '@repo/discord'
import type { EsiTypeResolver } from '@repo/esi'
import type { EveCharacterData } from '@repo/eve-character-data'
import type { EveCorporationData } from '@repo/eve-corporation-data'
import type { Groups } from '@repo/groups'
import type { Hr } from '@repo/hr'
import type { App } from '../../context'

const app = new Hono<App>()
const MS_PER_DAY = 86_400_000
const ACTIVE_MEMBER_THRESHOLD_MS = 7 * MS_PER_DAY
const DISCORD_USERNAME_LOOKUP_BATCH_SIZE = 25

function cloneRpcResult<T>(result: T): T {
	if (result === null || (typeof result !== 'object' && typeof result !== 'function')) {
		return result
	}
	return structuredClone(result)
}

/**
 * Cache duration for corporation member data (5 minutes)
 */
const CACHE_TTL = 5 * 60 // 5 minutes in seconds
const MEMBERS_ACCESS_DENIED_MESSAGE =
	'Access denied. Corporation CEO, Director, site admin, HR role, or HR auditor permission required.'
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

type MemberCorpHrAccess = {
	isMemberCorporation: boolean
}

type CorporationAccessScope = {
	corporationId: string
	name: string
	ticker: string
	isMemberCorporation: boolean
	isAltCorp: boolean
	isSpecialPurpose: boolean
}

type CorporationAccessScopeResponse = {
	hasAccess: boolean
	userRole: 'CEO' | 'Director' | 'admin' | 'hr_admin' | 'hr_reviewer' | 'hr_viewer' | null
	corporation: CorporationAccessScope | null
}

async function hasMemberCorpHrPermission(
	c: Context<App>,
	userId: string,
	corporationId: string,
	managedCorp: MemberCorpHrAccess | null,
	requiredRole: 'hr_viewer' | 'hr_admin'
): Promise<boolean> {
	if (!managedCorp?.isMemberCorporation) {
		return false
	}

	const hr = getStub<Hr>(c.env.HR, 'default')
	return hr.checkPermission(userId, corporationId, requiredRole)
}

async function resolveCorporationMembersAccess(
	c: Context<App>,
	corporationId: string,
	managedCorp: MemberCorpHrAccess | null
): Promise<'admin' | 'CEO' | 'Director' | 'hr_admin' | 'hr_reviewer' | 'hr_viewer'> {
	const user = c.get('user')!

	try {
		const access = await checkCorporationAccess(c, corporationId)
		return access.role
	} catch {
		const hr = getStub<Hr>(c.env.HR, 'default')
		const hasHrAccess = managedCorp?.isMemberCorporation
			? await hr.checkPermission(user.id, corporationId, 'hr_viewer')
			: false
		const isAuditor = !hasHrAccess && (await isHrAuditorUser(c))
		if (!hasHrAccess && !isAuditor) {
			throw new Error(
				'Access denied. Corporation CEO, Director, site admin, HR role, or HR auditor permission required.'
			)
		}
		if (isAuditor) {
			return 'hr_viewer'
		}
		const isHrAdmin = await hr.checkPermission(user.id, corporationId, 'hr_admin')
		const isHrReviewer =
			!isHrAdmin && (await hr.checkPermission(user.id, corporationId, 'hr_reviewer'))
		return isHrAdmin ? 'hr_admin' : isHrReviewer ? 'hr_reviewer' : 'hr_viewer'
	}
}

/**
 * GET /corporations/:corporationId/access
 * Corp-scoped access check used by single-corporation screens.
 * Returns the corporation metadata needed for page-level gating plus the access role.
 */
app.get('/:corporationId/access', requireAuth(), async (c) => {
	const corporationId = c.req.param('corporationId')
	const user = c.get('user')!
	const db = c.get('db')

	if (!db) {
		return c.json({ error: 'Database not available' }, 500)
	}

	try {
		const managedCorp = await db.query.managedCorporations.findFirst({
			where: and(
				eq(managedCorporations.corporationId, corporationId),
				eq(managedCorporations.isActive, true)
			),
			columns: {
				corporationId: true,
				name: true,
				ticker: true,
				isMemberCorporation: true,
				isAltCorp: true,
				isSpecialPurpose: true,
			},
		})

		if (!managedCorp) {
			const response: CorporationAccessScopeResponse = {
				hasAccess: false,
				userRole: null,
				corporation: null,
			}
			return c.json(response)
		}

		try {
			const userRole = await resolveCorporationMembersAccess(c, corporationId, {
				isMemberCorporation: managedCorp.isMemberCorporation,
			})

			const response: CorporationAccessScopeResponse = {
				hasAccess: true,
				userRole,
				corporation: managedCorp,
			}
			return c.json(response)
		} catch {
			logger.info('[Corporations] Corp-scoped access denied', {
				corporationId,
				userId: user.id,
			})
			const response: CorporationAccessScopeResponse = {
				hasAccess: false,
				userRole: null,
				corporation: managedCorp,
			}
			return c.json(response)
		}
	} catch (error) {
		logger.error('[Corporations] Failed to resolve corp-scoped access', {
			corporationId,
			userId: user.id,
			error: error instanceof Error ? error.message : String(error),
		})
		return c.json({ error: 'Failed to resolve corporation access' }, 500)
	}
})

type CorporationMemberListItem = {
	characterId: string
	characterName: string
	corporationId: string
	corporationName: string
	role: 'CEO' | 'Director' | 'Member'
	hasAuthAccount: boolean
	hasValidToken?: boolean | null
	authUserId?: string
	mainCharacterId?: string
	mainCharacterName?: string
	status?: 'active' | 'emeritus'
	discordUserId?: string | null
	discordUsername?: string | null
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
type MembersCoverageFilter = 'all' | 'full' | 'partial' | 'none' | 'unlinked'
type MembersActivityFilter = 'all' | 'active' | 'inactive' | 'unknown'
type MembersRoleFilter = 'all' | 'CEO' | 'Director' | 'Member'
type MembersSortField = 'name' | 'role' | 'hrRole' | 'auth' | 'activity' | 'lastLogin' | 'joinDate'
type MembersSortOrder = 'asc' | 'desc'

type MembersQuery = {
	page: number
	limit: number
	search: string
	mainsOnly: boolean
	authFilter: MembersAuthFilter
	coverageFilter: MembersCoverageFilter
	activityFilter: MembersActivityFilter
	roleFilter: MembersRoleFilter
	sortField: MembersSortField
	sortOrder: MembersSortOrder
}

type CorporationMemberCoverageInput = {
	characterId: string
	authUserId?: string
	hasValidToken?: boolean | null
}

type CorporationMemberCoverageSummary = {
	full: number
	partial: number
	none: number
	unlinked: number
	linkedUsers: number
	fullCharacters: number
	partialCharacters: number
	noneCharacters: number
	unlinkedCharacters: number
	totalCharacters: number
}

function countDistinctLinkedUsers(members: Array<{ authUserId?: string | null }>): number {
	return new Set(
		members
			.map((member) => member.authUserId)
			.filter((authUserId): authUserId is string => Boolean(authUserId))
	).size
}

function parseBoolean(value: string | undefined): boolean {
	return value === 'true' || value === '1'
}

function buildCorporationMemberCoverageSummary(
	members: CorporationMemberCoverageInput[]
): CorporationMemberCoverageSummary {
	const coverage = {
		full: 0,
		partial: 0,
		none: 0,
		unlinked: 0,
		linkedUsers: 0,
		fullCharacters: 0,
		partialCharacters: 0,
		noneCharacters: 0,
		unlinkedCharacters: 0,
		totalCharacters: members.length,
	}

	const bucketMap = new Map<string, { total: number; valid: number }>()

	for (const member of members) {
		if (!member.authUserId) {
			coverage.unlinked += 1
			continue
		}

		const bucketKey = `user:${member.authUserId}`
		const bucket = bucketMap.get(bucketKey) ?? { total: 0, valid: 0 }

		bucket.total += 1
		if (member.hasValidToken === true) {
			bucket.valid += 1
		}

		bucketMap.set(bucketKey, bucket)
	}

	const coverageByUserId = new Map<string, AccountCoverageStatus>()
	for (const bucket of bucketMap.values()) {
		if (bucket.valid === 0) {
			coverage.none += 1
		} else if (bucket.valid === bucket.total) {
			coverage.full += 1
		} else {
			coverage.partial += 1
		}
	}

	coverage.linkedUsers = bucketMap.size

	for (const [bucketKey, bucket] of bucketMap.entries()) {
		const userId = bucketKey.slice('user:'.length)
		const status: AccountCoverageStatus =
			bucket.valid === 0 ? 'none' : bucket.valid === bucket.total ? 'full' : 'partial'
		coverageByUserId.set(userId, status)
	}

	for (const member of members) {
		if (!member.authUserId) {
			coverage.unlinkedCharacters += 1
			continue
		}

		const status = coverageByUserId.get(member.authUserId) ?? 'none'
		if (status === 'full') {
			coverage.fullCharacters += 1
		} else if (status === 'partial') {
			coverage.partialCharacters += 1
		} else {
			coverage.noneCharacters += 1
		}
	}

	return coverage
}

function getHrRoleSortRank(role?: string | null): number {
	switch (role) {
		case 'hr_admin':
			return 0
		case 'hr_reviewer':
			return 1
		case 'hr_viewer':
			return 2
		default:
			return 3
	}
}

type AccountCoverageStatus = Exclude<MembersCoverageFilter, 'all'>

function buildCoverageStatusByUserId(
	members: CorporationMemberCoverageInput[]
): Map<string, AccountCoverageStatus> {
	const bucketMap = new Map<string, { total: number; valid: number }>()

	for (const member of members) {
		if (!member.authUserId) {
			continue
		}

		const bucketKey = `user:${member.authUserId}`
		const bucket = bucketMap.get(bucketKey) ?? { total: 0, valid: 0 }
		bucket.total += 1
		if (member.hasValidToken === true) {
			bucket.valid += 1
		}
		bucketMap.set(bucketKey, bucket)
	}

	const coverageByUserId = new Map<string, AccountCoverageStatus>()
	for (const [bucketKey, bucket] of bucketMap.entries()) {
		const userId = bucketKey.slice('user:'.length)
		const status: AccountCoverageStatus =
			bucket.valid === 0 ? 'none' : bucket.valid === bucket.total ? 'full' : 'partial'
		coverageByUserId.set(userId, status)
	}

	return coverageByUserId
}

function hasAnyMembersQueryParams(c: Context<App>): boolean {
	return (
		typeof c.req.query('page') === 'string' ||
		typeof c.req.query('limit') === 'string' ||
		typeof c.req.query('search') === 'string' ||
		typeof c.req.query('mainsOnly') === 'string' ||
		typeof c.req.query('authFilter') === 'string' ||
		typeof c.req.query('activityFilter') === 'string' ||
		typeof c.req.query('roleFilter') === 'string' ||
		typeof c.req.query('sortField') === 'string' ||
		typeof c.req.query('sortOrder') === 'string'
	)
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
	const mainsOnly = parseBoolean(c.req.query('mainsOnly'))
	const authFilterRaw = c.req.query('authFilter')
	const coverageFilterRaw = c.req.query('coverageFilter')
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
	const coverageFilter: MembersCoverageFilter =
		coverageFilterRaw === 'full' ||
		coverageFilterRaw === 'partial' ||
		coverageFilterRaw === 'none' ||
		coverageFilterRaw === 'unlinked'
			? coverageFilterRaw
			: 'all'
	const activityFilter: MembersActivityFilter =
		activityFilterRaw === 'active' ||
		activityFilterRaw === 'inactive' ||
		activityFilterRaw === 'unknown'
			? activityFilterRaw
			: 'all'
	const roleFilter: MembersRoleFilter =
		roleFilterRaw === 'CEO' || roleFilterRaw === 'Director' || roleFilterRaw === 'Member'
			? roleFilterRaw
			: 'all'
	const sortField: MembersSortField =
		sortFieldRaw === 'name' ||
		sortFieldRaw === 'role' ||
		sortFieldRaw === 'hrRole' ||
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
		mainsOnly,
		authFilter,
		coverageFilter,
		activityFilter,
		roleFilter,
		sortField,
		sortOrder,
	}
}

function canUseBackendPaginatedMembersPath(query: MembersQuery): boolean {
	return (
		!query.search &&
		!query.mainsOnly &&
		query.authFilter === 'all' &&
		query.coverageFilter === 'all' &&
		query.activityFilter === 'all' &&
		query.roleFilter === 'all' &&
		query.sortField === 'role' &&
		query.sortOrder === 'asc'
	)
}

function isMainCharacterMember(member: CorporationMemberListItem): boolean {
	return Boolean(
		member.hasAuthAccount && member.mainCharacterId && member.characterId === member.mainCharacterId
	)
}

function getMemberCoverageStatus(
	member: CorporationMemberListItem,
	coverageByUserId: Map<string, AccountCoverageStatus>
): MembersCoverageFilter {
	if (!member.hasAuthAccount || !member.authUserId) {
		return 'unlinked'
	}

	return coverageByUserId.get(member.authUserId) ?? 'none'
}

function filterSortAndPaginateMembers(
	members: CorporationMemberListItem[],
	query: MembersQuery,
	hrRoleMap?: Map<string, string>
) {
	const AUTH_SORT_RANK: Record<'valid' | 'invalid' | 'unknown' | 'unlinked', number> = {
		valid: 0,
		invalid: 1,
		unknown: 2,
		unlinked: 3,
	}
	const coverageByUserId = buildCoverageStatusByUserId(members)

	const getAuthSortRank = (member: CorporationMemberListItem): number => {
		const key: 'valid' | 'invalid' | 'unknown' | 'unlinked' = !member.hasAuthAccount
			? 'unlinked'
			: member.hasValidToken === true
				? 'valid'
				: member.hasValidToken === false
					? 'invalid'
					: 'unknown'
		return AUTH_SORT_RANK[key]
	}

	const filtered = [...members]
		.filter((member) => !query.mainsOnly || isMainCharacterMember(member))
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
				return (
					member.hasAuthAccount && member.hasValidToken !== true && member.hasValidToken !== false
				)
			}
			return true
		})
		.filter((member) => {
			if (query.coverageFilter === 'all') return true
			return getMemberCoverageStatus(member, coverageByUserId) === query.coverageFilter
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
			case 'hrRole': {
				const roleA = hrRoleMap?.get(a.authUserId || '') ?? null
				const roleB = hrRoleMap?.get(b.authUserId || '') ?? null
				comparison = getHrRoleSortRank(roleA) - getHrRoleSortRank(roleB)
				if (comparison === 0) {
					comparison = a.characterName.localeCompare(b.characterName)
				}
				break
			}
			case 'auth':
				comparison = (a.authUserId || '').localeCompare(b.authUserId || '')
				if (comparison === 0) {
					comparison = getAuthSortRank(a) - getAuthSortRank(b)
				}
				if (comparison === 0) {
					comparison = a.characterName.localeCompare(b.characterName)
				}
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
			linkedUsers: countDistinctLinkedUsers(filtered),
			active: filtered.filter((m) => m.activityStatus === 'active').length,
			inactive: filtered.filter((m) => m.activityStatus === 'inactive').length,
			directors: filtered.filter((m) => m.role === 'Director').length,
			esiCoverage: buildCorporationMemberCoverageSummary(members),
		},
	}
}

function buildUnpaginatedMembersResponse(members: CorporationMemberListItem[]) {
	return {
		items: members,
		pagination: {
			page: 1,
			limit: members.length,
			totalItems: members.length,
			totalPages: 1,
			hasNextPage: false,
			hasPreviousPage: false,
		},
		summary: {
			total: members.length,
			linked: members.filter((m) => m.hasAuthAccount).length,
			linkedUsers: countDistinctLinkedUsers(members),
			active: members.filter((m) => m.activityStatus === 'active').length,
			inactive: members.filter((m) => m.activityStatus === 'inactive').length,
			directors: members.filter((m) => m.role === 'Director').length,
			esiCoverage: buildCorporationMemberCoverageSummary(members),
		},
	}
}

function filterSortMembers(
	members: CorporationMemberListItem[],
	query: MembersQuery,
	hrRoleMap?: Map<string, string>
) {
	const AUTH_SORT_RANK: Record<'valid' | 'invalid' | 'unknown' | 'unlinked', number> = {
		valid: 0,
		invalid: 1,
		unknown: 2,
		unlinked: 3,
	}
	const coverageByUserId = buildCoverageStatusByUserId(members)

	const getAuthSortRank = (member: CorporationMemberListItem): number => {
		const key: 'valid' | 'invalid' | 'unknown' | 'unlinked' = !member.hasAuthAccount
			? 'unlinked'
			: member.hasValidToken === true
				? 'valid'
				: member.hasValidToken === false
					? 'invalid'
					: 'unknown'
		return AUTH_SORT_RANK[key]
	}

	const filtered = [...members]
		.filter((member) => !query.mainsOnly || isMainCharacterMember(member))
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
				return (
					member.hasAuthAccount && member.hasValidToken !== true && member.hasValidToken !== false
				)
			}
			return true
		})
		.filter((member) => {
			if (query.coverageFilter === 'all') return true
			return getMemberCoverageStatus(member, coverageByUserId) === query.coverageFilter
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
			case 'hrRole': {
				const roleA = hrRoleMap?.get(a.authUserId || '') ?? null
				const roleB = hrRoleMap?.get(b.authUserId || '') ?? null
				comparison = getHrRoleSortRank(roleA) - getHrRoleSortRank(roleB)
				if (comparison === 0) {
					comparison = a.characterName.localeCompare(b.characterName)
				}
				break
			}
			case 'auth':
				comparison = (a.authUserId || '').localeCompare(b.authUserId || '')
				if (comparison === 0) {
					comparison = getAuthSortRank(a) - getAuthSortRank(b)
				}
				if (comparison === 0) {
					comparison = a.characterName.localeCompare(b.characterName)
				}
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

	return filtered
}

function getEsiStatusLabel(
	member: Pick<CorporationMemberListItem, 'hasAuthAccount' | 'hasValidToken'>
) {
	if (!member.hasAuthAccount) return 'Unlinked'
	if (member.hasValidToken === true) return 'ESI Valid'
	if (member.hasValidToken === false) return 'ESI Invalid'
	return 'ESI Unknown'
}

function buildCorporationMembersCsv(
	members: CorporationMemberListItem[],
	hrRoleMap: Map<string, string>
): string {
	const headers = [
		'Character Name',
		'Character ID',
		'Role',
		'HR Role',
		'ESI Status',
		'Auth Account UUID',
		'Auth Account Primary Character Name',
		'Auth Account Primary Character ID',
		'Discord User ID',
		'Discord Username',
		'Activity Status',
		'Last Login',
		'Join Date',
	]

	const rows = members.map((member) => [
		member.characterName,
		member.characterId,
		member.role,
		hrRoleMap.get(member.authUserId || '') || '',
		getEsiStatusLabel(member),
		member.authUserId || '',
		member.mainCharacterName || '',
		member.mainCharacterId || '',
		member.discordUserId || '',
		member.discordUsername || '',
		member.activityStatus,
		member.lastLogin || 'Never',
		member.joinDate,
	])

	return [buildCsvLine(headers), ...rows.map((row) => buildCsvLine(row))].join('\n')
}

async function hydrateCorporationMembers(
	c: Context<App>,
	corporationId: string,
	managedCorp: { name: string },
	corpStub: EveCorporationData,
	typeResolver: EsiTypeResolver
): Promise<CorporationMemberListItem[]> {
	const db = c.get('db')
	if (!db) {
		throw new Error('Database not available')
	}

	const [corpInfo, coreData] = await Promise.all([
		withRpcResult(corpStub.getCorporationInfo(corporationId), (result) =>
			result ? { ...result } : null
		),
		withRpcResult(corpStub.getCoreData(corporationId), (result) =>
			result
				? {
						...result,
						members: result.members?.map((member) => ({ ...member })),
						memberTracking: result.memberTracking?.map((member) => ({ ...member })),
					}
				: null
		),
	])

	if (!coreData || !coreData.members) {
		return []
	}

	const memberCharacterIds = coreData.members.map((member) => String(member.characterId))
	const linkedCharacters =
		memberCharacterIds.length > 0
			? await db.query.userCharacters.findMany({
					where: inArray(userCharacters.characterId, memberCharacterIds),
				})
			: []
	const linkedCharacterMap = new Map(linkedCharacters.map((row) => [row.characterId, row]))
	const directors = await withRpcResult(corpStub.getDirectors(corporationId), (result) =>
		result.map((director) => ({ ...director }))
	)
	const directorIds = new Set(directors.map((director) => director.characterId))
	const characterNameMap =
		memberCharacterIds.length > 0 ? await typeResolver.resolveIds(memberCharacterIds) : {}
	const linkedUserIds = [...new Set(linkedCharacters.map((row) => row.userId))]
	const linkedUsers =
		linkedUserIds.length > 0
			? await db.query.users.findMany({
					where: inArray(users.id, linkedUserIds),
				})
			: []
	const mainCharacterIds = linkedUsers.map((user) => user.mainCharacterId)
	const mainCharacterNameMap =
		mainCharacterIds.length > 0 ? await typeResolver.resolveIds(mainCharacterIds) : {}
	const userIdToMainCharacterName = new Map(
		linkedUsers.map((user) => [user.id, mainCharacterNameMap[user.mainCharacterId] || 'Unknown'])
	)
	const userIdToMainCharacterId = new Map(
		linkedUsers.map((user) => [user.id, user.mainCharacterId])
	)
	const userIdToDiscordUserId = new Map(
		linkedUsers.map((user) => [user.id, user.discordUserId ?? null])
	)
	const userIdToDiscordUsername = new Map<string, string | null>()
	const discordUsers = linkedUsers.filter((user) => user.discordUserId)
	if (discordUsers.length > 0) {
		const discordStub = getStub<Discord>(c.env.DISCORD, 'default')
		for (
			let offset = 0;
			offset < discordUsers.length;
			offset += DISCORD_USERNAME_LOOKUP_BATCH_SIZE
		) {
			const batch = discordUsers.slice(offset, offset + DISCORD_USERNAME_LOOKUP_BATCH_SIZE)
			const statuses = await Promise.all(
				batch.map(async (user) => {
					try {
						const status = await withRpcResult(
							discordStub.getDiscordUserStatus(user.id),
							(result) => (result ? { username: result.username } : null)
						)
						return { userId: user.id, username: status?.username ?? null }
					} catch (error) {
						logger.warn('[Corporations] Failed to resolve Discord username for member export', {
							userId: user.id,
							discordUserId: user.discordUserId,
							error: error instanceof Error ? error.message : String(error),
						})
						return { userId: user.id, username: null }
					}
				})
			)
			for (const status of statuses) {
				userIdToDiscordUsername.set(status.userId, status.username)
			}
		}
	}
	const hrStub = getStub<Hr>(c.env.HR, 'default')
	const blacklistStatuses =
		memberCharacterIds.length > 0
			? await withRpcResult(hrStub.checkCharactersBlacklisted(memberCharacterIds), (result) => ({
					...result,
				}))
			: {}
	const now = Date.now()

	return coreData.members.map((member) => {
		const characterId = String(member.characterId)
		const linkedChar = linkedCharacterMap.get(characterId)
		let role: 'CEO' | 'Director' | 'Member' = 'Member'
		if (corpInfo && String(corpInfo.ceoId) === characterId) {
			role = 'CEO'
		} else if (directorIds.has(characterId)) {
			role = 'Director'
		}
		const tracking = coreData.memberTracking?.find((row) => row.characterId === characterId)

		return {
			characterId,
			characterName: characterNameMap[characterId] || 'Unknown',
			corporationId,
			corporationName: managedCorp.name,
			role,
			hasAuthAccount: !!linkedChar,
			hasValidToken: linkedChar ? (linkedChar.hasValidToken ?? null) : null,
			authUserId: linkedChar?.userId,
			mainCharacterId: linkedChar?.userId
				? userIdToMainCharacterId.get(linkedChar.userId)
				: undefined,
			mainCharacterName: linkedChar?.userId
				? userIdToMainCharacterName.get(linkedChar.userId)
				: undefined,
			discordUserId: linkedChar?.userId ? userIdToDiscordUserId.get(linkedChar.userId) : null,
			discordUsername: linkedChar?.userId
				? (userIdToDiscordUsername.get(linkedChar.userId) ?? null)
				: null,
			status: linkedChar?.status,
			joinDate: tracking?.startDate?.toISOString() || member.updatedAt.toISOString(),
			lastEsiUpdate: member.updatedAt.toISOString(),
			lastLogin: tracking?.logonDate?.toISOString(),
			allianceId: corpInfo?.allianceId ? String(corpInfo.allianceId) : undefined,
			allianceName: undefined,
			locationSystem: undefined,
			locationRegion: undefined,
			activityStatus: tracking?.logonDate
				? now - tracking.logonDate.getTime() < ACTIVE_MEMBER_THRESHOLD_MS
					? 'active'
					: 'inactive'
				: 'unknown',
			isBlacklisted: blacklistStatuses[characterId] || false,
		}
	})
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
		columns: {
			characterId: true,
			characterName: true,
			corporationId: true,
		},
	})

	logger.info('[Corporation Access] Checking user access', {
		corporationId,
		userId: user.id,
		userCharacterCount: userChars.length,
	})

	let userRole: 'CEO' | 'Director' | null = null
	const corpStub = getStub<EveCorporationData>(c.env.EVE_CORPORATION_DATA, corporationId)
	const [corpInfo, directors] = await Promise.all([
		withRpcResult(corpStub.getCorporationInfo(corporationId), (result) =>
			result ? { ceoId: result.ceoId } : null
		),
		withRpcResult(corpStub.getDirectors(corporationId), (result) =>
			result.map((director) => ({ characterId: director.characterId }))
		),
	])
	const directorIds = new Set(directors.map((d) => d.characterId))

	// Fast path: use persisted core.user_characters corporation affiliation.
	// This avoids expensive per-character DO reads on interactive member-search requests.
	const inCorpByPersistedAffiliation = userChars.filter(
		(character) => character.corporationId === corporationId
	)
	for (const character of inCorpByPersistedAffiliation) {
		if (corpInfo && String(corpInfo.ceoId) === character.characterId) {
			logger.info('[Corporation Access] CEO access granted', {
				characterId: character.characterId,
				characterName: character.characterName,
				corporationId,
				reason: 'persisted_corporation_ceo',
			})
			return { hasAccess: true, role: 'CEO' }
		}
		if (directorIds.has(character.characterId)) {
			userRole = 'Director'
			logger.info('[Corporation Access] Director access granted', {
				characterId: character.characterId,
				characterName: character.characterName,
				corporationId,
				reason: 'persisted_corporation_director',
			})
		}
	}

	// Fallback only for characters where persisted affiliation is missing.
	// This keeps correctness while minimizing slow EVE_CHARACTER_DATA round-trips.
	const unresolvedAffiliationCharacters = userChars.filter((character) => !character.corporationId)

	const charStub = getStub<EveCharacterData>(c.env.EVE_CHARACTER_DATA, 'default')
	for (const character of unresolvedAffiliationCharacters) {
		try {
			// Check if character is in this corporation
			const charData = await withRpcResult(
				charStub.getCharacterInfo(character.characterId),
				(result) => (result ? { corporationId: result.corporationId } : null)
			)

			// Skip if character is not in the target corporation
			if (!charData || String(charData.corporationId) !== corporationId) {
				continue
			}

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
			if (directorIds.has(character.characterId)) {
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
 *   search: string - search corporation name or ticker
 *   page: number - page number, starting at 1 (default 1)
 *   pageSize: 25|50|100 - results per page (default 25)
 */
app.get('/', requireAuth(), requireAdmin(), async (c) => {
	const db = c.get('db')

	if (!db) {
		return c.json({ error: 'Database not available' }, 500)
	}

	try {
		const parsedPage = Number.parseInt(c.req.query('page') ?? '1', 10)
		const page = Number.isFinite(parsedPage) ? Math.max(parsedPage, 1) : 1
		const requestedPageSize = Number.parseInt(c.req.query('pageSize') ?? '25', 10)
		const pageSize = [25, 50, 100].includes(requestedPageSize) ? requestedPageSize : null
		if (pageSize === null) {
			return c.json({ error: 'pageSize must be one of 25, 50, or 100' }, 400)
		}

		const corporationType = c.req.query('corporationType') as
			| 'member'
			| 'alt'
			| 'special'
			| 'other'
			| undefined
		const search = c.req.query('search')?.trim()

		// Corporation IDs are stored as text. Cast before applying the NPC range so
		// valid player corporations such as 1018389948 are not excluded by a
		// lexicographic comparison with 2000000.
		const corporationId = managedCorporations.corporationId
		const conditions = [
			sql`(${corporationId}::bigint < 1000000 OR ${corporationId}::bigint >= 2000000)`,
		]
		if (corporationType === 'member') {
			conditions.push(eq(managedCorporations.isMemberCorporation, true))
		} else if (corporationType === 'alt') {
			conditions.push(eq(managedCorporations.isAltCorp, true))
		} else if (corporationType === 'special') {
			conditions.push(eq(managedCorporations.isSpecialPurpose, true))
		} else if (corporationType === 'other') {
			// "Other" corporations are those that are not member, alt, or special purpose
			conditions.push(
				and(
					eq(managedCorporations.isMemberCorporation, false),
					eq(managedCorporations.isAltCorp, false),
					eq(managedCorporations.isSpecialPurpose, false)
				)!
			)
		}
		if (search) {
			const searchPattern = `%${search}%`
			conditions.push(
				or(
					ilike(managedCorporations.name, searchPattern),
					ilike(managedCorporations.ticker, searchPattern)
				)!
			)
		}
		const whereCondition = and(...conditions)!
		const cacheKey = [
			corporationType ?? 'all',
			search?.toLocaleLowerCase() ?? '',
			page,
			pageSize,
		].join(':')
		const response = await corporationListCache.getOrSet(cacheKey, async () => {
			const countRows = await db
				.select({ count: sql<number>`count(*)::int` })
				.from(managedCorporations)
				.where(whereCondition)
			const totalCount = countRows[0]?.count ?? 0
			const corporations = await db.query.managedCorporations.findMany({
				where: whereCondition,
				// Keep the page order stable and alphabetical across requests.
				orderBy: [asc(managedCorporations.name), asc(managedCorporations.corporationId)],
				limit: pageSize,
				offset: (page - 1) * pageSize,
			})

			return {
				data: corporations.map(
					({ lastSync, lastVerified, isVerified, healthyDirectorCount, ...corp }) => {
						corporationDirectorStatusCache.set(corp.corporationId, {
							lastVerified,
							isVerified,
							healthyDirectorCount,
						})
						corporationSyncStatusCache.set(corp.corporationId, { lastSync })
						return corp
					}
				),
				totalCount,
			}
		})

		const corporationIds = response.data.map((corporation) => corporation.corporationId)
		const missingDirectorStatusIds = corporationIds.filter(
			(corporationId) => !corporationDirectorStatusCache.has(corporationId)
		)
		const missingSyncStatusIds = corporationIds.filter(
			(corporationId) => !corporationSyncStatusCache.has(corporationId)
		)
		const missingStatusIds = [...new Set([...missingDirectorStatusIds, ...missingSyncStatusIds])]

		if (missingStatusIds.length > 0) {
			const statusRows = await db.query.managedCorporations.findMany({
				where: inArray(managedCorporations.corporationId, missingStatusIds),
				columns: {
					corporationId: true,
					lastSync: true,
					lastVerified: true,
					isVerified: true,
					healthyDirectorCount: true,
				},
			})
			for (const row of statusRows) {
				corporationDirectorStatusCache.set(row.corporationId, {
					lastVerified: row.lastVerified,
					isVerified: row.isVerified,
					healthyDirectorCount: row.healthyDirectorCount,
				})
				corporationSyncStatusCache.set(row.corporationId, { lastSync: row.lastSync })
			}
		}

		const missingHealthIds = corporationIds.filter(
			(corporationId) => !corporationHealthCache.has(corporationId)
		)
		if (missingHealthIds.length > 0) {
			try {
				const healthyDirectorCounts =
					await c.env.EVE_CORPORATION_DATA_WORKER.getHealthyDirectorCounts(missingHealthIds)
				for (const corporationId of missingHealthIds) {
					corporationHealthCache.set(corporationId, healthyDirectorCounts[corporationId] ?? null)
				}
			} catch (error) {
				logger.warn('[Corporations] Failed to batch-enrich live director health', {
					error: error instanceof Error ? error.message : String(error),
				})
			}
		}

		const data = response.data.map((corporation) => {
			const directorStatus = corporationDirectorStatusCache.get(corporation.corporationId)
			const syncStatus = corporationSyncStatusCache.get(corporation.corporationId)
			const liveHealthyDirectorCount = corporationHealthCache.get(corporation.corporationId)
			return {
				...corporation,
				...directorStatus,
				...syncStatus,
				healthyDirectorCount:
					typeof liveHealthyDirectorCount === 'number'
						? liveHealthyDirectorCount
						: (directorStatus?.healthyDirectorCount ?? 0),
			}
		})
		const totalPages = response.totalCount === 0 ? 0 : Math.ceil(response.totalCount / pageSize)
		return c.json({
			data,
			pagination: {
				page,
				pageSize,
				totalCount: response.totalCount,
				totalPages,
				hasNextPage: page < totalPages,
				hasPreviousPage: page > 1 && totalPages > 0,
			},
		})
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
 * CEOs, Directors, site admins, and member-corp HR staff can access their corporation
 * even if not recruiting
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
			const managedCorp = await db.query.managedCorporations.findFirst({
				where: and(
					eq(managedCorporations.corporationId, corporationId),
					eq(managedCorporations.isActive, true)
				),
				columns: {
					isMemberCorporation: true,
				},
			})
			const hasHrRole = await hasMemberCorpHrPermission(
				c,
				user.id,
				corporationId,
				managedCorp ?? null,
				'hr_viewer'
			)
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
 * Update corporation recruiting settings (CEO, admin, or member-corp HR admin)
 * Updates isRecruiting, shortDescription, and fullDescription fields
 */
app.patch('/:corporationId/settings', requireAuth(), async (c) => {
	const user = c.get('user')!
	const corporationId = c.req.param('corporationId')
	const db = c.get('db')

	if (!db) {
		return c.json({ error: 'Database not available' }, 500)
	}

	const managedCorp = await db.query.managedCorporations.findFirst({
		where: and(
			eq(managedCorporations.corporationId, corporationId),
			eq(managedCorporations.isActive, true)
		),
		columns: {
			isMemberCorporation: true,
		},
	})
	const isAuditor = await isHrAuditorUser(c)
	if (!managedCorp?.isMemberCorporation && !user.is_admin && !isAuditor) {
		return c.json(
			{ error: 'Access denied. Corporation CEO, site admin, or HR admin required.' },
			403
		)
	}

	// Authorization check - user must be CEO, site admin, or HR admin
	try {
		await checkCorporationAccess(c, corporationId)
	} catch {
		// CEO/Director/Admin check failed — fall back to HR admin check
		const hasHrAdmin = await hasMemberCorpHrPermission(
			c,
			user.id,
			corporationId,
			managedCorp ?? null,
			'hr_admin'
		)
		if (!hasHrAdmin) {
			return c.json(
				{ error: 'Access denied. Corporation CEO, site admin, or HR admin required.' },
				403
			)
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
		clearCorporationListCache()

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
			includeInStructureAssetSync,
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
				includeInStructureAssetSync: includeInStructureAssetSync ?? false,
				isVerified: false,
				configuredBy: user.id,
			})
			.returning()
		clearCorporationListCache()

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

			// Sync corporation config settings
			if (includeInBackgroundRefresh !== undefined || includeInStructureAssetSync !== undefined) {
				await stub.updateCorporationConfig(corporationId, {
					includeInBackgroundRefresh,
					includeInStructureAssetSync,
				})
				logger.info('[Corporations] Synced corporation config to eve-corporation-data', {
					corporationId,
					includeInBackgroundRefresh,
					includeInStructureAssetSync,
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
			doConfig = await withRpcResult(stub.getConfiguration(), (result) =>
				result ? { ...result } : null
			)
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
			includeInStructureAssetSync,
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
		const memberCorpStatusChanged =
			isMemberCorporation !== undefined && isMemberCorporation !== existing.isMemberCorporation

		if (memberCorpStatusChanged) {
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
					const allPermissions = await withRpcResult(groupsStub.listPermissions(), (result) =>
						result.map((permission) => ({
							...permission,
							category: permission.category ? { ...permission.category } : null,
						}))
					)
					const testAlliancePermission = allPermissions.find((p) => p.urn === testAllianceUrn)

					if (testAlliancePermission) {
						// Check if permission is already attached
						const existingPermissions = await withRpcResult(
							groupsStub.listCorporationPermissions(corporationId),
							(result) =>
								result.map((permission) => ({
									...permission,
									permission: permission.permission
										? {
												...permission.permission,
												category: permission.permission.category
													? { ...permission.permission.category }
													: null,
											}
										: null,
								}))
						)
						const alreadyAttached = existingPermissions.some(
							(cp) => cp.permission?.urn === testAllianceUrn
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
					const corpPermissions = await withRpcResult(
						groupsStub.listCorporationPermissions(corporationId),
						(result) =>
							result.map((permission) => ({
								...permission,
								permission: permission.permission
									? {
											...permission.permission,
											category: permission.permission.category
												? { ...permission.permission.category }
												: null,
										}
									: null,
							}))
					)
					const testAllianceCorpPermission = corpPermissions.find(
						(cp) => cp.permission?.urn === testAllianceUrn
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

		// Member-corp status changes affect Discord entitlement scope. Force-queue
		// refresh for all linked users with characters in this corporation.
		if (memberCorpStatusChanged) {
			try {
				const linkedUsers = await db
					.select({ userId: userCharacters.userId })
					.from(userCharacters)
					.where(eq(userCharacters.corporationId, corporationId))
				const uniqueUserIds = [...new Set(linkedUsers.map((row) => row.userId))]
				if (uniqueUserIds.length > 0) {
					const coreStub = getStub<Core>(c.env.CORE, 'default')
					const queueResult = await coreStub.addPendingDiscordRefreshes(uniqueUserIds, {
						source: isMemberCorporation ? 'corp-member-flag-enabled' : 'corp-member-flag-disabled',
						force: true,
						allowRemoval: true,
						hardStripAllRoles: !isMemberCorporation,
					})
					logger.info('[Corporations] Queued Discord refresh after member-corp status change', {
						corporationId,
						isMemberCorporation,
						usersMatched: uniqueUserIds.length,
						usersQueued: queueResult.added,
						usersSkipped: queueResult.skipped,
						pendingCount: queueResult.pendingCount,
					})
				}
			} catch (error) {
				logger.error(
					'[Corporations] Failed to queue Discord refresh after member-corp status change',
					{
						corporationId,
						isMemberCorporation,
						error: error instanceof Error ? error.message : String(error),
					}
				)
				// Non-fatal: setting update should still complete.
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
				...(includeInStructureAssetSync !== undefined && { includeInStructureAssetSync }),
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
		clearCorporationListCache()

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

		// Sync corporation config settings to eve-corporation-data DB
		if (includeInBackgroundRefresh !== undefined || includeInStructureAssetSync !== undefined) {
			try {
				const stub = getStub<EveCorporationData>(c.env.EVE_CORPORATION_DATA, corporationId)
				await stub.updateCorporationConfig(corporationId, {
					includeInBackgroundRefresh,
					includeInStructureAssetSync,
				})
				logger.info('[Corporations] Synced corporation config to eve-corporation-data', {
					corporationId,
					includeInBackgroundRefresh,
					includeInStructureAssetSync,
				})
			} catch (error) {
				logger.error('[Corporations] Failed to sync corporation config', {
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
		clearCorporationListCache()

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
		const stub = getStub<EveCorporationData>(c.env.EVE_CORPORATION_DATA, corporationId)

		logger.info('[Corporations] Verifying corporation access', { corporationId })
		const verification = await withRpcResult(stub.verifyAccess(corporationId), cloneRpcResult)

		const healthyDirectorCount = await stub.getHealthyDirectorCount(corporationId)

		await db
			.update(managedCorporations)
			.set({
				isVerified: healthyDirectorCount > 0,
				healthyDirectorCount,
				lastVerified: verification.lastVerified || new Date(),
				updatedAt: new Date(),
			})
			.where(eq(managedCorporations.corporationId, corporationId))
		clearCorporationStatusCache(corporationId)

		if (verification.hasAccess) {
			logger.info('[Corporations] Corporation access verified', {
				corporationId,
				healthyDirectorCount,
				verifiedRoles: verification.verifiedRoles,
			})
		} else {
			logger.warn('[Corporations] Corporation access verification failed', {
				corporationId,
				healthyDirectorCount,
				missingRoles: verification.missingRoles,
			})
		}

		return c.json({ ...verification, healthyDirectorCount })
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
 *   category?: 'all' | 'public' | 'core' | 'financial' | 'assets' | 'structures' | 'market' | 'killmails'
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
				logger.info('[Corporations] Fetching assets and structure inventory', {
					corporationId,
					forceRefresh: true,
				})
				await stub.fetchAssetsData(corporationId, true)
				break
			case 'market':
				logger.info('[Corporations] Fetching market data', { corporationId })
				await stub.fetchMarketData(corporationId, forceRefresh)
				break
			case 'killmails':
				logger.info('[Corporations] Fetching killmails', { corporationId })
				await stub.fetchKillmails(corporationId, forceRefresh)
				break
			case 'structures':
				logger.info('[Corporations] Fetching structures', { corporationId })
				await c.env.STRUCTURES.syncCorporationStructures(corporationId, forceRefresh)
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
		clearCorporationStatusCache(corporationId)

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
				withRpcResult(
					stub.getCorporationInfo(corporationId).catch((e: unknown) => {
						logger.error('[Corporations] getCorporationInfo failed', {
							corporationId,
							error: e instanceof Error ? e.message : String(e),
							stack: e instanceof Error ? e.stack : undefined,
						})
						return null
					}),
					cloneRpcResult
				),
				withRpcResult(
					stub.getCoreData(corporationId).catch((e: unknown) => {
						logger.error('[Corporations] getCoreData failed', {
							corporationId,
							error: e instanceof Error ? e.message : String(e),
							stack: e instanceof Error ? e.stack : undefined,
						})
						return null
					}),
					cloneRpcResult
				),
				withRpcResult(
					stub.getFinancialData(corporationId).catch((e: unknown) => {
						logger.error('[Corporations] getFinancialData failed', {
							corporationId,
							error: e instanceof Error ? e.message : String(e),
							stack: e instanceof Error ? e.stack : undefined,
						})
						return null
					}),
					cloneRpcResult
				),
				withRpcResult(
					stub.getAssetsData(corporationId).catch((e: unknown) => {
						logger.error('[Corporations] getAssetsData failed', {
							corporationId,
							error: e instanceof Error ? e.message : String(e),
							stack: e instanceof Error ? e.stack : undefined,
						})
						return null
					}),
					cloneRpcResult
				),
				withRpcResult(
					stub.getMarketData(corporationId).catch((e: unknown) => {
						logger.error('[Corporations] getMarketData failed', {
							corporationId,
							error: e instanceof Error ? e.message : String(e),
							stack: e instanceof Error ? e.stack : undefined,
						})
						return null
					}),
					cloneRpcResult
				),
				withRpcResult(
					stub.getKillmails(corporationId, 10).catch((e: unknown) => {
						logger.error('[Corporations] getKillmails failed', {
							corporationId,
							error: e instanceof Error ? e.message : String(e),
							stack: e instanceof Error ? e.stack : undefined,
						})
						return []
					}),
					cloneRpcResult
				),
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
	const allMembers = parseBoolean(c.req.query('all'))
	const hasMembersQuery = hasAnyMembersQueryParams(c)
	const returnUnpaginated = allMembers || !hasMembersQuery
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

		let userRole: 'admin' | 'CEO' | 'Director' | 'hr_admin' | 'hr_reviewer' | 'hr_viewer'
		try {
			userRole = await resolveCorporationMembersAccess(c, corporationId, managedCorp)
		} catch (error) {
			if (error instanceof Error && error.message === MEMBERS_ACCESS_DENIED_MESSAGE) {
				return c.json({ error: error.message }, 403)
			}
			throw error
		}

		logger.info('[Corporations] User has access', { corporationId, userId: user.id, userRole })

		// Check cache for member data
		const cacheKey = getCorpMembersCacheKey(corporationId)
		const cached = await getCachedJson<CorporationMemberListItem[]>(cacheKey)
		const corpStub = getStub<EveCorporationData>(c.env.EVE_CORPORATION_DATA, corporationId)
		const typeResolver = getStub<EsiTypeResolver>(c.env.ESI_TYPE_RESOLVER, 'global')
		const hrStub = getStub<Hr>(c.env.HR, 'default')
		const hrRoles =
			query.sortField === 'hrRole'
				? await withRpcResult(hrStub.getCorporationRoles(corporationId, true), (result) =>
						result.map((role) => ({ ...role }))
					)
				: []
		const hrRoleMap =
			hrRoles.length > 0 ? new Map(hrRoles.map((role) => [role.userId, role.role])) : undefined

		const useBackendPagination =
			!returnUnpaginated &&
			canUseBackendPaginatedMembersPath(query) &&
			typeof (corpStub as unknown as { getMembersPaginated?: unknown }).getMembersPaginated ===
				'function'

		if (useBackendPagination) {
			const paged = await withRpcResult(
				(
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
				).getMembersPaginated(corporationId, query.page, query.limit),
				(result) => ({
					...result,
					items: result.items.map((item) => ({ ...item })),
					pagination: { ...result.pagination },
					summary: { ...result.summary },
				})
			)

			const pageCharacterIds = paged.items.map((item) => item.characterId)
			const linkedCharacters =
				pageCharacterIds.length > 0
					? await db.query.userCharacters.findMany({
							where: inArray(userCharacters.characterId, pageCharacterIds),
						})
					: []
			const linkedCharacterMap = new Map(linkedCharacters.map((row) => [row.characterId, row]))
			const characterNameMap =
				pageCharacterIds.length > 0 ? await typeResolver.resolveIds(pageCharacterIds) : {}

			const linkedUserIds = [...new Set(linkedCharacters.map((row) => row.userId))]
			const linkedUsers =
				linkedUserIds.length > 0
					? await db.query.users.findMany({
							where: inArray(users.id, linkedUserIds),
						})
					: []
			const mainCharacterIds = linkedUsers.map((u) => u.mainCharacterId)
			const mainCharacterNameMap =
				mainCharacterIds.length > 0 ? await typeResolver.resolveIds(mainCharacterIds) : {}
			const userIdToMainCharacterName = new Map(
				linkedUsers.map((u) => [u.id, mainCharacterNameMap[u.mainCharacterId] || 'Unknown'])
			)
			const userIdToMainCharacterId = new Map(linkedUsers.map((u) => [u.id, u.mainCharacterId]))

			const blacklistStatuses =
				pageCharacterIds.length > 0
					? await withRpcResult(hrStub.checkCharactersBlacklisted(pageCharacterIds), (result) => ({
							...result,
						}))
					: {}

			// These are lightweight member-summary fields used by list/search pages.
			// They intentionally stop short of private character hydration so they
			// remain non-alerting and safe to use in incidental list views.
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
					mainCharacterId: linkedChar?.userId
						? userIdToMainCharacterId.get(linkedChar.userId)
						: undefined,
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
			const linkedUserSummaryRow = await db
				.select({
					count: sql<number>`count(distinct ${userCharacters.userId})`.as('count'),
				})
				.from(userCharacters)
				.where(eq(userCharacters.corporationId, corporationId))
				.then((rows) => rows[0] ?? { count: 0 })

			let esiCoverage: CorporationMemberCoverageSummary = {
				full: 0,
				partial: 0,
				none: 0,
				unlinked: 0,
				linkedUsers: 0,
				fullCharacters: 0,
				partialCharacters: 0,
				noneCharacters: 0,
				unlinkedCharacters: 0,
				totalCharacters: 0,
			}
			try {
				const coverageMemberRows = await withRpcResult(
					corpStub.getMembers(corporationId),
					(result) => result.map((member) => ({ characterId: String(member.characterId) }))
				)
				const coverageMemberIds = coverageMemberRows.map((row) => String(row.characterId))
				const coverageLinkedCharacters =
					coverageMemberIds.length > 0
						? await db.query.userCharacters.findMany({
								where: inArray(userCharacters.characterId, coverageMemberIds),
							})
						: []
				const coverageLinkedCharacterMap = new Map(
					coverageLinkedCharacters.map((row) => [row.characterId, row])
				)
				esiCoverage = buildCorporationMemberCoverageSummary(
					coverageMemberIds.map((characterId) => {
						const linkedChar = coverageLinkedCharacterMap.get(characterId)
						return {
							characterId,
							authUserId: linkedChar?.userId,
							hasValidToken: linkedChar ? (linkedChar.hasValidToken ?? null) : null,
						}
					})
				)
			} catch (error) {
				logger.warn('[Corporations] Failed to calculate member ESI coverage summary', {
					corporationId,
					error: error instanceof Error ? error.message : String(error),
				})
			}

			const response = {
				items: pageMembers,
				pagination: paged.pagination,
				summary: {
					total: paged.summary.total,
					linked: Number(linkedSummaryRow.count ?? 0),
					linkedUsers: Number(linkedUserSummaryRow.count ?? 0),
					active: paged.summary.active,
					inactive: paged.summary.inactive,
					directors: paged.summary.directors,
					esiCoverage,
				},
			}

			return c.json(response)
		}

		if (cached) {
			logger.info('[Corporations] Returning cached member data', {
				corporationId,
				memberCount: cached.length,
				page: query.page,
				limit: query.limit,
				search: query.search,
			})
			const response = returnUnpaginated
				? buildUnpaginatedMembersResponse(
						query.mainsOnly ? cached.filter(isMainCharacterMember) : cached
					)
				: filterSortAndPaginateMembers(cached, query, hrRoleMap)
			return c.json(response)
		}

		// Get corporation members from DO
		const [corpInfo, coreData] = await Promise.all([
			withRpcResult(corpStub.getCorporationInfo(corporationId), (result) =>
				result ? { ...result } : null
			),
			withRpcResult(corpStub.getCoreData(corporationId), (result) =>
				result
					? {
							...result,
							members: result.members?.map((member) => ({ ...member })),
							memberTracking: result.memberTracking?.map((member) => ({ ...member })),
						}
					: null
			),
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
		const directors = await withRpcResult(corpStub.getDirectors(corporationId), (result) =>
			result.map((director) => ({ ...director }))
		)
		const directorIds = new Set(directors.map((d) => d.characterId))

		// Batch resolve all character names using ESI bulk endpoint
		// Character ID → name mappings are cached for 1 year (essentially permanent)
		const characterNameMap = await typeResolver.resolveIds(memberCharacterIds)

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
			mainCharacterIds.length > 0 ? await typeResolver.resolveIds(mainCharacterIds) : {}

		// Create a map from userId to main character name
		const userIdToMainCharacterName = new Map(
			linkedUsers.map((u) => [u.id, mainCharacterNameMap[u.mainCharacterId] || 'Unknown'])
		)
		const userIdToMainCharacterId = new Map(linkedUsers.map((u) => [u.id, u.mainCharacterId]))

		logger.info('[Corporations Members] Resolved main character names for linked accounts', {
			corporationId,
			linkedAccountCount: linkedUserIds.length,
			resolvedMainCharacters: Object.keys(mainCharacterNameMap).length,
		})

		// Bulk check blacklist status for all members
		const blacklistStatuses =
			memberCharacterIds.length > 0
				? await withRpcResult(hrStub.checkCharactersBlacklisted(memberCharacterIds), (result) => ({
						...result,
					}))
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
					mainCharacterId: linkedChar?.userId
						? userIdToMainCharacterId.get(linkedChar.userId)
						: undefined,
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
						? new Date().getTime() - tracking.logonDate.getTime() < ACTIVE_MEMBER_THRESHOLD_MS
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

		const response = returnUnpaginated
			? buildUnpaginatedMembersResponse(
					query.mainsOnly ? membersWithDetails.filter(isMainCharacterMember) : membersWithDetails
				)
			: filterSortAndPaginateMembers(membersWithDetails, query, hrRoleMap)
		return c.json(response)
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
 * GET /corporations/:corporationId/members/export
 * Download a CSV of all corporation members matching the current filters.
 */
app.get('/:corporationId/members/export', requireAuth(), async (c) => {
	const corporationId = c.req.param('corporationId')
	const query = parseMembersQuery(c)
	const user = c.get('user')!
	const db = c.get('db')

	if (!db) {
		return c.json({ error: 'Database not available' }, 500)
	}

	logger.info('[Corporations] Export members request', { corporationId, userId: user.id })

	try {
		const managedCorp = await db.query.managedCorporations.findFirst({
			where: and(
				eq(managedCorporations.corporationId, corporationId),
				eq(managedCorporations.isActive, true)
			),
		})

		if (!managedCorp) {
			return c.json({ error: 'Corporation not found or not managed' }, 404)
		}

		let userRole: 'admin' | 'CEO' | 'Director' | 'hr_admin' | 'hr_reviewer' | 'hr_viewer'
		try {
			userRole = await resolveCorporationMembersAccess(c, corporationId, managedCorp)
		} catch (error) {
			if (error instanceof Error && error.message === MEMBERS_ACCESS_DENIED_MESSAGE) {
				return c.json({ error: error.message }, 403)
			}
			throw error
		}

		logger.info('[Corporations] Export members access granted', {
			corporationId,
			userId: user.id,
			userRole,
		})

		const corpStub = getStub<EveCorporationData>(c.env.EVE_CORPORATION_DATA, corporationId)
		const typeResolver = getStub<EsiTypeResolver>(c.env.ESI_TYPE_RESOLVER, 'global')
		const hrStub = getStub<Hr>(c.env.HR, 'default')
		const members = await hydrateCorporationMembers(
			c,
			corporationId,
			managedCorp,
			corpStub,
			typeResolver
		)
		const hrRoles = await withRpcResult(hrStub.getCorporationRoles(corporationId, true), (result) =>
			result.map((role) => ({ ...role }))
		)
		const hrRoleMap = new Map(hrRoles.map((role) => [role.userId, role.role]))
		const filteredMembers = filterSortMembers(members, query, hrRoleMap)
		const csv = buildCorporationMembersCsv(filteredMembers, hrRoleMap)
		const safeFileName =
			managedCorp.name
				.trim()
				.replace(/[^a-zA-Z0-9._-]+/g, '-')
				.replace(/^-+|-+$/g, '')
				.toLowerCase() || 'corporation'

		return new Response(csv, {
			status: 200,
			headers: {
				'Content-Type': 'text/csv; charset=utf-8',
				'Content-Disposition': `attachment; filename="${safeFileName}-members.csv"`,
				'Cache-Control': 'no-store',
			},
		})
	} catch (error) {
		logger.error('[Corporations] Error exporting corporation members', {
			corporationId,
			error: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : undefined,
		})
		return c.json({ error: 'Failed to export corporation members' }, 500)
	}
})

/**
 * GET /corporations/:corporationId/members/:accountId
 * Get a single linked auth account's in-corp member detail (non-paginated)
 */
app.get('/:corporationId/members/:accountId', requireAuth(), async (c) => {
	const corporationId = c.req.param('corporationId')
	const accountId = c.req.param('accountId')
	const user = c.get('user')!
	const db = c.get('db')

	if (!db) {
		return c.json({ error: 'Database not available' }, 500)
	}

	try {
		const managedCorp = await db.query.managedCorporations.findFirst({
			where: and(
				eq(managedCorporations.corporationId, corporationId),
				eq(managedCorporations.isActive, true)
			),
		})

		if (!managedCorp) {
			return c.json({ error: 'Corporation not found or not managed' }, 404)
		}

		try {
			await checkCorporationAccess(c, corporationId)
		} catch {
			const hr = getStub<Hr>(c.env.HR, 'default')
			const hasHrAccess = managedCorp.isMemberCorporation
				? await hr.checkPermission(user.id, corporationId, 'hr_viewer')
				: false
			const isAuditor = !hasHrAccess && (await isHrAuditorUser(c))
			if (!hasHrAccess && !isAuditor) {
				return c.json(
					{
						error:
							'Access denied. Corporation CEO, Director, site admin, HR role, or HR auditor permission required.',
					},
					403
				)
			}
		}

		// The linked-account page is user-scoped first, then intersected with the
		// corporation's current member roster. This avoids relying on a stored
		// corporationId on user_characters for CEO/director or auditor access paths.
		const linkedCharacters = await db.query.userCharacters.findMany({
			where: eq(userCharacters.userId, accountId),
		})
		if (linkedCharacters.length === 0) {
			return c.json({ error: 'Member account not found in corporation' }, 404)
		}

		const memberCharIdSet = new Set(linkedCharacters.map((row) => row.characterId))
		const corpStub = getStub<EveCorporationData>(c.env.EVE_CORPORATION_DATA, corporationId)
		const typeResolver = getStub<EsiTypeResolver>(c.env.ESI_TYPE_RESOLVER, 'global')
		const [corpInfo, coreData, currentMembers, directors] = await Promise.all([
			withRpcResult(corpStub.getCorporationInfo(corporationId), (result) =>
				result ? { ...result } : null
			),
			withRpcResult(corpStub.getCoreData(corporationId), (result) =>
				result
					? {
							...result,
							members: result.members?.map((member) => ({ ...member })),
							memberTracking: result.memberTracking?.map((member) => ({ ...member })),
						}
					: null
			),
			withRpcResult(corpStub.getMembers(corporationId), (result) =>
				result.map((member) => ({ ...member }))
			),
			withRpcResult(corpStub.getDirectors(corporationId), (result) =>
				result.map((director) => ({ ...director }))
			),
		])

		const directorIds = new Set(directors.map((d) => d.characterId))
		const rosterMembers = currentMembers.length > 0 ? currentMembers : (coreData?.members ?? [])
		if (rosterMembers.length === 0) {
			return c.json({ error: 'Member account not found in corporation' }, 404)
		}

		const matchingMembers = rosterMembers.filter((member) =>
			memberCharIdSet.has(String(member.characterId))
		)
		if (matchingMembers.length === 0) {
			return c.json({ error: 'Member account not found in corporation' }, 404)
		}

		const characterIds = matchingMembers.map((member) => String(member.characterId))
		const characterNameMap = await withRpcResult(
			typeResolver.resolveIds(characterIds),
			(result) => ({
				...result,
			})
		)

		const linkedUser = await db.query.users.findFirst({
			where: eq(users.id, accountId),
		})
		const discordUsername =
			linkedUser?.discordUserId && accountId
				? await withRpcResult(
						getStub<Discord>(c.env.DISCORD, 'default').getDiscordUserStatus(accountId),
						(result) => result?.username ?? null
					)
				: null
		const mainCharacterNameMap = linkedUser?.mainCharacterId
			? await withRpcResult(typeResolver.resolveIds([linkedUser.mainCharacterId]), (result) => ({
					...result,
				}))
			: {}
		const mainCharacterName = linkedUser?.mainCharacterId
			? (mainCharacterNameMap[linkedUser.mainCharacterId] ?? undefined)
			: undefined

		const hrStub = getStub<Hr>(c.env.HR, 'default')
		const blacklistStatuses =
			characterIds.length > 0
				? await withRpcResult(hrStub.checkCharactersBlacklisted(characterIds), (result) => ({
						...result,
					}))
				: {}

		const memberRows: CorporationMemberListItem[] = matchingMembers.map((member) => {
			const characterId = String(member.characterId)
			const linkedChar = linkedCharacters.find((row) => row.characterId === characterId)
			const tracking = coreData?.memberTracking?.find((row) => row.characterId === characterId)
			let role: 'CEO' | 'Director' | 'Member' = 'Member'
			if (corpInfo && String(corpInfo.ceoId) === characterId) {
				role = 'CEO'
			} else if (directorIds.has(characterId)) {
				role = 'Director'
			}

			return {
				characterId,
				characterName: characterNameMap[characterId] || 'Unknown',
				corporationId,
				corporationName: managedCorp.name,
				role,
				hasAuthAccount: true,
				hasValidToken: linkedChar ? (linkedChar.hasValidToken ?? null) : null,
				authUserId: linkedChar?.userId,
				mainCharacterName,
				status: linkedChar?.status,
				discordUserId: linkedUser?.discordUserId ?? null,
				discordUsername,
				joinDate: tracking?.startDate?.toISOString() || member.updatedAt.toISOString(),
				lastEsiUpdate: member.updatedAt.toISOString(),
				lastLogin: tracking?.logonDate?.toISOString(),
				allianceId: corpInfo?.allianceId ? String(corpInfo.allianceId) : undefined,
				allianceName: undefined,
				locationSystem: undefined,
				locationRegion: undefined,
				activityStatus: tracking?.logonDate
					? new Date().getTime() - tracking.logonDate.getTime() < ACTIVE_MEMBER_THRESHOLD_MS
						? 'active'
						: 'inactive'
					: 'unknown',
				isBlacklisted: blacklistStatuses[characterId] || false,
			}
		})

		const rows = memberRows
		const mainName =
			rows.find((row) => row.mainCharacterName)?.mainCharacterName ??
			rows[0]?.characterName ??
			'Unknown'
		const representative = rows.find((row) => row.characterName === mainName) ?? rows[0]
		const roleRank: Record<'CEO' | 'Director' | 'Member', number> = {
			CEO: 0,
			Director: 1,
			Member: 2,
		}
		const highestRole = rows.reduce<'CEO' | 'Director' | 'Member'>((best, row) => {
			return roleRank[row.role] < roleRank[best] ? row.role : best
		}, 'Member')

		return c.json({
			account: {
				accountId,
				mainName,
				representative,
				characters: [...rows].sort((a, b) => {
					if (a.characterName === mainName) return -1
					if (b.characterName === mainName) return 1
					return a.characterName.localeCompare(b.characterName)
				}),
				isLinked: true,
				highestRole,
				hasBlacklisted: rows.some((row) => row.isBlacklisted),
			},
		})
	} catch (error) {
		logger.error('[Corporations] Error fetching member account detail', {
			corporationId,
			accountId,
			error: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : undefined,
		})
		return c.json({ error: 'Failed to fetch member account detail' }, 500)
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
		clearCorporationSyncStatusCache(corporationId)

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
		const corpInfo = await withRpcResult(corpStub.getCorporationInfo(corporationId), (result) =>
			result ? { ceoId: result.ceoId } : null
		)

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
		const coreData = await withRpcResult(corpStub.getCoreData(corporationId), (result) =>
			result
				? {
						members: result.members?.map((member) => ({ characterId: member.characterId })),
					}
				: null
		)
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
app.route('/', corporationsAlertsRoutes)
app.route('/', corporationsDiscordRoutes)
app.route('/', corporationsPermissionsRoutes)

export default app
