import { Hono } from 'hono'
import { z } from 'zod'

import { and, desc, eq, ilike, inArray, or } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'
import { TimeCache } from '@repo/hono-helpers'
import {
	CreateCommentSchema,
	CreateSRPPolicySchema,
	CreateSRPRequestSchema,
	EditCommentSchema,
	REQUEST_STATUSES,
	SRPReviewSubmissionSchema,
	UpdateReviewStateSchema,
	UpdateSRPConfigSchema,
} from '@repo/srp'

import { createDb } from '../db'
import { managedCorporations, userCharacters } from '../db/schema'
import { getCachedUserPermissions } from '../lib/groups-cache'
import { requireAllianceMember } from '../middleware/session'

import type { Doctrines, FittingWithItems } from '@repo/doctrines'
import type { EveCharacterData } from '@repo/eve-character-data'
import type { EveTokenStore } from '@repo/eve-token-store'
import type { SRPCommentResponse, SRPRequestResponse, Srp } from '@repo/srp'
import type { Universe } from '@repo/universe'
import type { App } from '../context'

const ApproveRequestSchema = z.object({
	approvedAmount: z.string(),
	reviewNotes: z.string().max(2000).optional(),
})

const PartiallyApproveRequestSchema = z.object({
	approvedAmount: z.string(),
	rejectionReason: z.string().min(10).max(2000),
	reviewNotes: z.string().max(2000).optional(),
})

const RejectRequestSchema = z.object({
	rejectionReason: z.string().min(10).max(2000),
	reviewNotes: z.string().max(2000).optional(),
})

const RequestStatusQuerySchema = z.enum(REQUEST_STATUSES)
const RequestSearchFieldQuerySchema = z.enum(['character', 'ship', 'system'])

/**
 * Permission check cache - 15 second TTL
 * Caches the boolean result of permission checks
 */
const permissionCache = new TimeCache<boolean>(15000)

/**
 * Helper function to get Cloudflare request ID for DO instance isolation
 * Falls back to random UUID if cf-ray header is not present
 */
function getRequestId(c: any): string {
	return c.req.header('cf-ray') || crypto.randomUUID()
}

/** Get the primary character name for the session user */
function getPrimaryCharacterName(user: any): string {
	return user.characters.find((c: any) => c.is_primary)?.characterName ?? 'Unknown'
}

const SRP_ROLE_URNS = ['urn:srp:reviewer', 'urn:srp:payer', 'urn:srp:manager']
const SRP_REQUIRED_KILLMAIL_SCOPES = ['esi-killmails.read_killmails.v1'] as const
const SRP_REQUEST_ID_PATTERN = /^\d+$/

function isValidSrpRequestId(requestId: string): boolean {
	return SRP_REQUEST_ID_PATTERN.test(requestId)
}

/** Hydrate authorCharacterName, authorCharacterId, and authorRole on comments */
async function hydrateCommentAuthors(
	comments: SRPCommentResponse[],
	databaseUrl: string,
	env: { GROUPS: DurableObjectNamespace },
	requestUserId: string
): Promise<SRPCommentResponse[]> {
	if (comments.length === 0) return comments
	const userIds = [...new Set(comments.map((c) => c.authorUserId))]
	const db = createDb(databaseUrl)
	const rows = await db
		.select({
			userId: userCharacters.userId,
			characterName: userCharacters.characterName,
			characterId: userCharacters.characterId,
		})
		.from(userCharacters)
		.where(and(eq(userCharacters.is_primary, true), inArray(userCharacters.userId, userIds)))
	const charMap = Object.fromEntries(
		rows.map((r) => [r.userId, { name: r.characterName, characterId: r.characterId }])
	)

	// Determine SRP staff role for each non-requestor author
	const nonRequestorIds = userIds.filter((id) => id !== requestUserId)
	const staffSet = new Set<string>()
	await Promise.all(
		nonRequestorIds.map(async (userId) => {
			const perms = await getCachedUserPermissions(env, userId)
			if (perms.some((p) => SRP_ROLE_URNS.includes(p.urn))) {
				staffSet.add(userId)
			}
		})
	)

	return comments.map((c) => ({
		...c,
		authorCharacterName: charMap[c.authorUserId]?.name ?? c.authorCharacterName,
		authorCharacterId: charMap[c.authorUserId]?.characterId,
		authorRole:
			c.authorUserId === requestUserId
				? 'requestor'
				: staffSet.has(c.authorUserId)
					? 'staff'
					: undefined,
	}))
}

type RequestWithCharacterRole = SRPRequestResponse & { characterRole?: 'main' | 'alt' }
type DoctrineSlot = 'high' | 'mid' | 'low' | 'rig' | 'sub'
type MilitarySrpFindingCode =
	| 'missing_rigs'
	| 'module_missing'
	| 'module_variant_mismatch'

interface MilitarySrpFinding {
	code: MilitarySrpFindingCode
	slot?: DoctrineSlot
	message: string
	suggestedPenaltyPercent?: number
	doctrineTypeId?: string
	doctrineTypeName?: string
	actualTypeId?: string
	actualTypeName?: string
	groupName?: string
	quantity?: number
}

interface MilitarySrpAssessment {
	isMilitary: boolean
	doctrineFittingId?: string
	doctrineFittingName?: string
	doctrineCategory?: string
	hasConformityIssues: boolean
	suggestedPenaltyPercent: number
	findings: MilitarySrpFinding[]
}

type RequestWithMilitarySrp = RequestWithCharacterRole & { militarySrp?: MilitarySrpAssessment }
type RequestWithKillmailItemNames = RequestWithMilitarySrp & {
	killmailItemNames?: Record<string, string>
}

const MISSING_RIG_PENALTY_PERCENT = 10

function classifyDoctrineSlot(flagId: string): DoctrineSlot | null {
	const flag = Number.parseInt(flagId, 10)
	if (!Number.isFinite(flag)) return null
	if (flag >= 27 && flag <= 34) return 'high'
	if (flag >= 19 && flag <= 26) return 'mid'
	if (flag >= 11 && flag <= 18) return 'low'
	if (flag >= 92 && flag <= 99) return 'rig'
	if (flag >= 125 && flag <= 132) return 'sub'
	return null
}

function classifyLossSlot(flag: number): DoctrineSlot | null {
	if (flag >= 27 && flag <= 34) return 'high'
	if (flag >= 19 && flag <= 26) return 'mid'
	if (flag >= 11 && flag <= 18) return 'low'
	if (flag >= 92 && flag <= 99) return 'rig'
	if (flag >= 125 && flag <= 132) return 'sub'
	return null
}

function sumLossQuantity(item: {
	quantity_destroyed?: number
	quantity_dropped?: number
}): number {
	const total = (item.quantity_destroyed ?? 0) + (item.quantity_dropped ?? 0)
	return total > 0 ? total : 1
}

function normalizeDoctrineQuantity(qty: string): number {
	const parsed = Number.parseInt(qty, 10)
	return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
}

function buildDoctrineTypeCounts(
	fitting: FittingWithItems
): Map<DoctrineSlot, Map<string, number>> {
	const bySlot = new Map<DoctrineSlot, Map<string, number>>()
	for (const item of fitting.fittingItems) {
		const slot = classifyDoctrineSlot(item.flagId)
		if (!slot) continue
		const slotMap = bySlot.get(slot) ?? new Map<string, number>()
		slotMap.set(item.typeId, (slotMap.get(item.typeId) ?? 0) + normalizeDoctrineQuantity(item.quantity))
		bySlot.set(slot, slotMap)
	}
	return bySlot
}

function buildLossTypeCounts(
	lossItems: Array<{
		item_type_id?: number
		flag?: number
		quantity_destroyed?: number
		quantity_dropped?: number
	}>
): Map<DoctrineSlot, Map<string, number>> {
	const bySlot = new Map<DoctrineSlot, Map<string, number>>()
	for (const item of lossItems) {
		if (item.item_type_id == null || item.flag == null) continue
		const slot = classifyLossSlot(item.flag)
		if (!slot) continue
		const typeId = String(item.item_type_id)
		const slotMap = bySlot.get(slot) ?? new Map<string, number>()
		slotMap.set(typeId, (slotMap.get(typeId) ?? 0) + sumLossQuantity(item))
		bySlot.set(slot, slotMap)
	}
	return bySlot
}

function scoreFittingMatch(
	fitting: FittingWithItems,
	lossItems: Array<{
		item_type_id?: number
		flag?: number
		quantity_destroyed?: number
		quantity_dropped?: number
	}>
): number {
	const doctrineCounts = buildDoctrineTypeCounts(fitting)
	const lossCounts = buildLossTypeCounts(lossItems)
	let score = 0
	for (const [slot, docTypes] of doctrineCounts) {
		const lossTypes = lossCounts.get(slot)
		if (!lossTypes) continue
		for (const [typeId, expectedQty] of docTypes) {
			score += Math.min(expectedQty, lossTypes.get(typeId) ?? 0)
		}
	}
	return score
}

async function enrichRequestsWithMilitarySrp(
	requests: RequestWithCharacterRole[],
	env: {
		DOCTRINES: DurableObjectNamespace
		UNIVERSE: DurableObjectNamespace
	}
): Promise<RequestWithMilitarySrp[]> {
	if (requests.length === 0) return requests

	const doctrinesStub = getStub<Doctrines>(env.DOCTRINES, 'default')
	const universeStub = getStub<Universe>(env.UNIVERSE, 'default')
	const fittingsByShip = new Map<string, FittingWithItems[]>()

	async function getCandidateFittings(shipTypeId: string): Promise<FittingWithItems[]> {
		const cached = fittingsByShip.get(shipTypeId)
		if (cached) return cached

		const eligible = await doctrinesStub.getFittings({ shipTypeId, srpEligible: true })
		const fallback = eligible.length > 0 ? eligible : await doctrinesStub.getFittings({ shipTypeId })
		if (fallback.length === 0) {
			fittingsByShip.set(shipTypeId, [])
			return []
		}

		const full = (await Promise.all(fallback.map((f) => doctrinesStub.getFitting(f.id)))).filter(
			(f): f is FittingWithItems => f !== null
		)
		fittingsByShip.set(shipTypeId, full)
		return full
	}

	return Promise.all(
		requests.map(async (request) => {
			const shipTypeId = request.shipTypeId
			const lossItems = (request.killmailItems as any[] | undefined) ?? []
			if (!shipTypeId || lossItems.length === 0) {
				return {
					...request,
					militarySrp: {
						isMilitary: false,
						hasConformityIssues: false,
						suggestedPenaltyPercent: 0,
						findings: [],
					},
				}
			}

			const candidates = await getCandidateFittings(shipTypeId)
			if (candidates.length === 0) {
				return {
					...request,
					militarySrp: {
						isMilitary: false,
						hasConformityIssues: false,
						suggestedPenaltyPercent: 0,
						findings: [],
					},
				}
			}

			const best = candidates
				.map((fitting) => ({
					fitting,
					score: scoreFittingMatch(fitting, lossItems),
				}))
				.sort((left, right) => right.score - left.score)[0]?.fitting

			if (!best) {
				return {
					...request,
					militarySrp: {
						isMilitary: false,
						hasConformityIssues: false,
						suggestedPenaltyPercent: 0,
						findings: [],
					},
				}
			}

			const findings: MilitarySrpFinding[] = []
			const doctrineBySlot = buildDoctrineTypeCounts(best)
			const lossBySlot = buildLossTypeCounts(lossItems)
			const comparedTypeIds = new Set<string>()

			for (const item of best.fittingItems) {
				comparedTypeIds.add(item.typeId)
			}
			for (const item of lossItems) {
				if (item?.item_type_id != null) comparedTypeIds.add(String(item.item_type_id))
			}

			const typeMap = await universeStub
				.resolveTypeNamesByIds([...comparedTypeIds])
				.catch(() => ({} as Record<string, null>))
			const doctrineGroupIds = [...new Set(best.fittingItems.map((item) => item.groupId).filter(Boolean))]
			const lossGroupIds = [
				...new Set(
					[...comparedTypeIds]
						.map((typeId) => typeMap[typeId]?.groupId)
						.filter((groupId): groupId is string => Boolean(groupId))
				),
			]
			const groupMap = await universeStub
				.resolveInvGroups([...new Set([...doctrineGroupIds, ...lossGroupIds])])
				.catch(() => ({} as Record<string, null>))

			const expectedRigCount = [...(doctrineBySlot.get('rig')?.values() ?? [])].reduce(
				(acc, qty) => acc + qty,
				0
			)
			const actualRigCount = [...(lossBySlot.get('rig')?.values() ?? [])].reduce(
				(acc, qty) => acc + qty,
				0
			)
			const missingRigs = Math.max(0, expectedRigCount - actualRigCount)
			if (missingRigs > 0) {
				findings.push({
					code: 'missing_rigs',
					slot: 'rig',
					quantity: missingRigs,
					message: `Missing ${missingRigs} rig module${missingRigs > 1 ? 's' : ''} from doctrine fit`,
					suggestedPenaltyPercent: missingRigs * MISSING_RIG_PENALTY_PERCENT,
				})
			}

			const lossGroupCounts = new Map<string, Map<string, number>>()
			for (const lossItem of lossItems) {
				if (lossItem?.item_type_id == null || lossItem.flag == null) continue
				const slot = classifyLossSlot(lossItem.flag)
				if (!slot) continue
				const typeId = String(lossItem.item_type_id)
				const groupId = typeMap[typeId]?.groupId
				if (!groupId) continue
				const key = `${slot}:${groupId}`
				const groupTypes = lossGroupCounts.get(key) ?? new Map<string, number>()
				groupTypes.set(typeId, (groupTypes.get(typeId) ?? 0) + sumLossQuantity(lossItem))
				lossGroupCounts.set(key, groupTypes)
			}

			for (const [slot, doctrineTypes] of doctrineBySlot) {
				const actualTypes = lossBySlot.get(slot) ?? new Map<string, number>()

				for (const [typeId, expectedQty] of doctrineTypes) {
					const actualQty = actualTypes.get(typeId) ?? 0
					if (actualQty >= expectedQty) continue

					const doctrineItem = best.fittingItems.find(
						(item) => item.typeId === typeId && classifyDoctrineSlot(item.flagId) === slot
					)
					const doctrineTypeName = doctrineItem?.typeName ?? typeMap[typeId]?.typeName ?? typeId
					const groupId = doctrineItem?.groupId
					const groupName = groupId ? (groupMap[groupId]?.groupName ?? undefined) : undefined
					const key = groupId ? `${slot}:${groupId}` : null
					const sameGroupActual = key ? lossGroupCounts.get(key) : undefined
					const swappedType = sameGroupActual
						? [...sameGroupActual.keys()].find((candidateTypeId) => candidateTypeId !== typeId)
						: undefined

					if (swappedType) {
						findings.push({
							code: 'module_variant_mismatch',
							slot,
							quantity: expectedQty - actualQty,
							message: `Doctrine expects ${doctrineTypeName}, but loss fit uses ${typeMap[swappedType]?.typeName ?? swappedType}`,
							doctrineTypeId: typeId,
							doctrineTypeName,
							actualTypeId: swappedType,
							actualTypeName: typeMap[swappedType]?.typeName ?? swappedType,
							groupName,
						})
					} else {
						findings.push({
							code: 'module_missing',
							slot,
							quantity: expectedQty - actualQty,
							message: `Missing ${expectedQty - actualQty}x ${doctrineTypeName} (${slot} slot)`,
							doctrineTypeId: typeId,
							doctrineTypeName,
							groupName,
						})
					}
				}
			}

			const suggestedPenaltyPercent = findings.reduce(
				(acc, finding) => acc + (finding.suggestedPenaltyPercent ?? 0),
				0
			)

			return {
				...request,
				militarySrp: {
					isMilitary: true,
					doctrineFittingId: best.id,
					doctrineFittingName: best.name,
					doctrineCategory: best.category,
					hasConformityIssues: findings.length > 0,
					suggestedPenaltyPercent,
					findings,
				},
			}
		})
	)
}

async function enrichRequestWithKillmailItemNames(
	request: RequestWithMilitarySrp,
	env: { UNIVERSE: DurableObjectNamespace }
): Promise<RequestWithKillmailItemNames> {
	const killmailItems = (request.killmailItems as any[] | undefined) ?? []
	if (killmailItems.length === 0) return request

	const typeIds = [
		...new Set(
			killmailItems
				.map((item) => item?.item_type_id)
				.filter((itemTypeId): itemTypeId is number => typeof itemTypeId === 'number')
				.map(String)
		),
	]
	if (typeIds.length === 0) return request

	const universeStub = getStub<Universe>(env.UNIVERSE, 'default')
	const typeMap = await universeStub
		.resolveTypeNamesByIds(typeIds)
		.catch(() => ({} as Record<string, null>))
	const killmailItemNames: Record<string, string> = {}
	for (const typeId of typeIds) {
		const typeName = typeMap[typeId]?.typeName
		if (typeName) killmailItemNames[typeId] = typeName
	}

	return {
		...request,
		killmailItemNames,
	}
}

async function hydrateRequestCharacterRoles(
	requests: RequestWithCharacterRole[],
	databaseUrl: string
): Promise<RequestWithCharacterRole[]> {
	if (requests.length === 0) return requests

	const userIds = [...new Set(requests.map((request) => request.userId))]
	const db = createDb(databaseUrl)
	const rows = await db
		.select({
			userId: userCharacters.userId,
			characterId: userCharacters.characterId,
		})
		.from(userCharacters)
		.where(and(eq(userCharacters.is_primary, true), inArray(userCharacters.userId, userIds)))

	const mainCharacterByUserId = new Map(rows.map((row) => [row.userId, row.characterId]))

	return requests.map((request) => {
		const mainCharacterId = mainCharacterByUserId.get(request.userId)
		if (!mainCharacterId) return request
		return {
			...request,
			characterRole: request.characterId === mainCharacterId ? 'main' : 'alt',
		}
	})
}

/**
 * Helper function to check if a user has a specific permission
 * Results are cached for 15 seconds to reduce load on Groups DO
 */
async function hasPermission(
	env: { GROUPS: DurableObjectNamespace },
	userId: string,
	permissionUrn: string,
	isAdmin: boolean
): Promise<boolean> {
	// Admins bypass permission checks
	if (isAdmin) return true

	// Check cache or fetch user permissions
	const cacheKey = `${userId}:${permissionUrn}`
	return permissionCache.getOrSet(cacheKey, async () => {
		const permissions = await getCachedUserPermissions(env, userId)
		return permissions.some((p) => p.urn === permissionUrn)
	})
}

async function hasAnyPermission(
	env: { GROUPS: DurableObjectNamespace },
	userId: string,
	permissionUrns: string[],
	isAdmin: boolean
): Promise<boolean> {
	if (isAdmin) return true
	const permissions = await getCachedUserPermissions(env, userId)
	return permissionUrns.some((urn) => permissions.some((p) => p.urn === urn))
}

type SrpTier = 'reviewer' | 'payer' | 'manager'

function getSrpTierPermissions(minimumTier: SrpTier): string[] {
	if (minimumTier === 'manager') return ['urn:srp:manager']
	if (minimumTier === 'payer') return ['urn:srp:payer', 'urn:srp:manager']
	return ['urn:srp:reviewer', 'urn:srp:payer', 'urn:srp:manager']
}

async function hasSrpTierPermission(
	env: { GROUPS: DurableObjectNamespace },
	userId: string,
	minimumTier: SrpTier,
	isAdmin: boolean
): Promise<boolean> {
	return hasAnyPermission(env, userId, getSrpTierPermissions(minimumTier), isAdmin)
}

/**
 * SRP (Ship Replacement Program) routes
 *
 * Provides API endpoints for managing SRP requests, reviews, payments, and configuration.
 * All requests are authenticated before being forwarded to the SRP Durable Object.
 */
const srp = new Hono<App>()

// Apply authentication middleware to all routes
srp.use('*', requireAllianceMember())
srp.use('*', async (c, next) => {
	const srpBinding = c.env.SRP as Partial<DurableObjectNamespace> | undefined
	const hasValidBinding =
		typeof srpBinding?.idFromName === 'function' && typeof srpBinding?.get === 'function'
	if (!hasValidBinding) {
		return c.json({ error: 'SRP is currently disabled' }, 503)
	}
	return next()
})

// =============================================================================
// LOSSES
// =============================================================================

/**
 * Get recent losses for all user's characters with SRP status
 * GET /api/srp/losses?daysBack=30
 */
srp.get('/losses', async (c) => {
	const user = c.get('user')!
	const daysBack = c.req.query('daysBack') ? Number.parseInt(c.req.query('daysBack')!, 10) : 30

	// Get all character IDs for the user
	const characterIds = user.characters.map((char) => char.characterId)

	if (characterIds.length === 0) {
		return c.json([])
	}

	const srpStub = getStub<Srp>(c.env.SRP, getRequestId(c))
	const losses = await srpStub.getRecentLosses(characterIds, user.id, daysBack)
	const characterNameById = new Map(
		user.characters.map((character) => [character.characterId, character.characterName])
	)
	const lossesWithCharacterNames = losses.map((loss) => ({
		...loss,
		victimCharacterName: characterNameById.get(loss.victimCharacterId) ?? undefined,
	}))

	return c.json(lossesWithCharacterNames)
})

/**
 * Trigger killmail refresh for all of the user's characters
 * POST /api/srp/losses/refresh
 * Returns per-character results so the UI can show partial failures.
 */
srp.post('/losses/refresh', async (c) => {
	const user = c.get('user')!
	const tokenStore = getStub<EveTokenStore>(c.env.EVE_TOKEN_STORE, 'default')

	const settled = await Promise.allSettled(
		user.characters.map(async (char) => {
			const tokenValidation = await tokenStore.validateToken(
				char.characterId,
				SRP_REQUIRED_KILLMAIL_SCOPES
			)
			if (!tokenValidation.isValid) {
				return {
					characterId: char.characterId,
					characterName: char.characterName,
					success: false,
					reason: 'invalid_token' as const,
					tokenStatus: tokenValidation.status,
					tokenError: tokenValidation.error,
				}
			}
			try {
				const stub = getStub<EveCharacterData>(c.env.EVE_CHARACTER_DATA, char.characterId)
				const instance = await stub.getInstance(char.characterId)
				using charInstance = instance
				await charInstance.fetchKillmails()
				return { characterId: char.characterId, characterName: char.characterName, success: true }
			} catch (err) {
				return {
					characterId: char.characterId,
					characterName: char.characterName,
					success: false,
					reason: 'fetch_failed' as const,
					error: err instanceof Error ? err.message : String(err),
				}
			}
		})
	)

	const results = settled.map((s) =>
		s.status === 'fulfilled'
			? s.value
			: { characterId: '', characterName: 'Unknown', success: false, reason: 'fetch_failed' as const, error: String(s.reason) }
	)

	return c.json({ results })
})

// =============================================================================
// KILLMAIL PREVIEW
// =============================================================================

/**
 * GET /api/srp/losses/preview?killmailId=...&killmailHash=...&characterId=...
 * Returns valuation + raw victim items for the fitting panel without creating a request.
 */
srp.get('/losses/preview', async (c) => {
	const user = c.get('user')!
	const killmailId = c.req.query('killmailId')
	const killmailHash = c.req.query('killmailHash')
	const characterId = c.req.query('characterId')

	if (!killmailId || !killmailHash || !characterId) {
		return c.json({ error: 'killmailId, killmailHash, and characterId are required' }, 400)
	}

	const ownsCharacter = user.characters.some((ch) => ch.characterId === characterId)
	if (!ownsCharacter) {
		return c.json({ error: 'Not authorized' }, 403)
	}

	const srpStub = getStub<Srp>(c.env.SRP, getRequestId(c))
	const preview = await srpStub.previewValuation(characterId, killmailId, killmailHash)

	if (!preview) return c.json(null)
	return c.json(preview)
})

// =============================================================================
// REQUESTS
// =============================================================================

/**
 * Create a new SRP request
 * POST /api/srp/requests
 */
srp.post('/requests', async (c) => {
	const user = c.get('user')!
	const body = await c.req.json()

	// Validate request body
	const validation = CreateSRPRequestSchema.safeParse(body)
	if (!validation.success) {
		return c.json({ error: 'Invalid request data', details: validation.error }, 400)
	}

	const { characterId, killmailId, killmailHash, contextText } = validation.data

	// Verify user owns this character
	const ownsCharacter = user.characters.some((char) => char.characterId === characterId)
	if (!ownsCharacter) {
		return c.json({ error: 'Not authorized to create request for this character' }, 403)
	}

	const srpStub = getStub<Srp>(c.env.SRP, getRequestId(c))
	let request: Awaited<ReturnType<Srp['createRequest']>>
	try {
		request = await srpStub.createRequest(
			user.id,
			characterId,
			killmailId,
			killmailHash,
			contextText
		)
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err)
		if (message.includes('maximum allowed age')) {
			return c.json({ error: message }, 422)
		}
		throw err
	}

	return c.json(request, 201)
})

/**
 * Get user's SRP requests
 * GET /api/srp/requests?limit=50&offset=0
 */
srp.get('/requests', async (c) => {
	const user = c.get('user')!
	const limit = c.req.query('limit') ? Number.parseInt(c.req.query('limit')!, 10) : 50
	const offset = c.req.query('offset') ? Number.parseInt(c.req.query('offset')!, 10) : 0

	const srpStub = getStub<Srp>(c.env.SRP, getRequestId(c))
	const requestsRaw = await srpStub.getUserRequests(user.id, limit, offset)
	const withCharacterRoles = await hydrateRequestCharacterRoles(
		requestsRaw as RequestWithCharacterRole[],
		c.env.DATABASE_URL
	)
	const requests = await enrichRequestsWithMilitarySrp(withCharacterRoles, c.env)

	return c.json({
		requests,
		total: requests.length,
		limit,
		offset,
	})
})

/**
 * Get requests by status (reviewer queue)
 * GET /api/srp/requests/by-status?status=pending&limit=50&offset=0
 */
srp.get('/requests/by-status', async (c) => {
	const user = c.get('user')!
	const statusParsed = RequestStatusQuerySchema.safeParse(c.req.query('status'))
	if (!statusParsed.success) {
		return c.json({ error: 'Invalid status' }, 400)
	}

	const status = statusParsed.data
	const limit = c.req.query('limit') ? Number.parseInt(c.req.query('limit')!, 10) : 50
	const offset = c.req.query('offset') ? Number.parseInt(c.req.query('offset')!, 10) : 0
	const characterName = c.req.query('characterName')?.trim() || undefined
	const shipTypeName = c.req.query('shipTypeName')?.trim() || undefined
	const solarSystemName = c.req.query('solarSystemName')?.trim() || undefined
	const dateFrom = c.req.query('dateFrom')?.trim() || undefined
	const dateTo = c.req.query('dateTo')?.trim() || undefined

	const canAccessReviewQueue = await hasSrpTierPermission(c.env, user.id, 'reviewer', user.is_admin)
	if (!canAccessReviewQueue) return c.json({ error: 'Requires SRP staff permissions' }, 403)

	const srpStub = getStub<Srp>(c.env.SRP, getRequestId(c))
	const result = await srpStub.getRequestsByStatus(status, {
		limit,
		offset,
		characterName,
		shipTypeName,
		solarSystemName,
		dateFrom,
		dateTo,
	})
	const withCharacterRoles = await hydrateRequestCharacterRoles(
		result.requests as RequestWithCharacterRole[],
		c.env.DATABASE_URL
	)
	const requests = await enrichRequestsWithMilitarySrp(withCharacterRoles, c.env)
	return c.json({
		requests,
		total: result.total,
		limit,
		offset,
	})
})

/**
 * Get search values for review queue filters
 * GET /api/srp/requests/search-values?status=pending&field=character&query=ab
 */
srp.get('/requests/search-values', async (c) => {
	const user = c.get('user')!
	const statusParsed = RequestStatusQuerySchema.safeParse(c.req.query('status'))
	if (!statusParsed.success) {
		return c.json({ error: 'Invalid status' }, 400)
	}
	const fieldParsed = RequestSearchFieldQuerySchema.safeParse(c.req.query('field'))
	if (!fieldParsed.success) {
		return c.json({ error: 'Invalid field' }, 400)
	}

	const query = c.req.query('query')?.trim() ?? ''
	const canAccessReviewQueueSearch = await hasSrpTierPermission(
		c.env,
		user.id,
		'reviewer',
		user.is_admin
	)
	if (!canAccessReviewQueueSearch) return c.json({ error: 'Requires SRP staff permissions' }, 403)

	const srpStub = getStub<Srp>(c.env.SRP, getRequestId(c))
	const values = await srpStub.getSearchValues(statusParsed.data, fieldParsed.data, query)
	return c.json(values)
})

/**
 * Get a single SRP request
 * GET /api/srp/requests/:id
 */
srp.get('/requests/:id', async (c) => {
	const user = c.get('user')!
	const requestId = c.req.param('id')
	if (!isValidSrpRequestId(requestId)) {
		return c.json({ error: 'Invalid request id' }, 400)
	}

	const srpStub = getStub<Srp>(c.env.SRP, getRequestId(c))
	const request = await srpStub.getRequest(requestId, user.id)

	if (!request) {
		return c.json({ error: 'Request not found' }, 404)
	}

	const canSeeInternalHistory = await hasAnyPermission(c.env, user.id, SRP_ROLE_URNS, user.is_admin)
	const canViewRequest = request.userId === user.id || canSeeInternalHistory
	if (!canViewRequest) {
		return c.json({ error: 'Not authorized to view this request' }, 403)
	}

	if (request.comments && request.comments.length > 0) {
		request.comments = await hydrateCommentAuthors(
			request.comments,
			c.env.DATABASE_URL,
			c.env,
			request.userId
		)
	}

	if (request.history && !canSeeInternalHistory) {
		request.history = request.history
			.filter((entry) => entry.visibility === 'public')
			.map((entry) => ({
				...entry,
				previousApprovedAmount: undefined,
			}))
	}

	const [requestWithCharacterRole] = await hydrateRequestCharacterRoles(
		[request as RequestWithCharacterRole],
		c.env.DATABASE_URL
	)
	const [militaryEnrichedRequest] = await enrichRequestsWithMilitarySrp([requestWithCharacterRole], c.env)
	const requestWithKillmailNames = await enrichRequestWithKillmailItemNames(
		militaryEnrichedRequest,
		c.env
	)
	return c.json(requestWithKillmailNames)
})

// =============================================================================
// REVIEW WORKFLOWS
// =============================================================================

/**
 * Get pending SRP requests for review
 * GET /api/srp/pending?corporationId=xxx&limit=50&offset=0
 *
 * Requires admin or reviewer permissions
 */
srp.get('/pending', async (c) => {
	const user = c.get('user')!
	const corporationId = c.req.query('corporationId')
	const limit = c.req.query('limit') ? Number.parseInt(c.req.query('limit')!, 10) : 50
	const offset = c.req.query('offset') ? Number.parseInt(c.req.query('offset')!, 10) : 0

	// Check reviewer permissions
	const canReview = await hasSrpTierPermission(c.env, user.id, 'reviewer', user.is_admin)
	if (!canReview) {
		return c.json({ error: 'Requires SRP staff permissions' }, 403)
	}

	const srpStub = getStub<Srp>(c.env.SRP, getRequestId(c))
	const requestsRaw = await srpStub.getPendingRequests(corporationId || '', limit, offset)
	const requests = await enrichRequestsWithMilitarySrp(
		requestsRaw as RequestWithCharacterRole[],
		c.env
	)

	return c.json({
		requests,
		total: requests.length,
		limit,
		offset,
	})
})

/**
 * Approve an SRP request
 * POST /api/srp/requests/:id/approve
 */
srp.post('/requests/:id/approve', async (c) => {
	const user = c.get('user')!
	const requestId = c.req.param('id')
	if (!isValidSrpRequestId(requestId)) {
		return c.json({ error: 'Invalid request id' }, 400)
	}
	const body = await c.req.json()

	// Validate request body
	const validation = ApproveRequestSchema.safeParse(body)
	if (!validation.success) {
		return c.json({ error: 'Invalid request data', details: validation.error }, 400)
	}

	// Check reviewer permissions
	const canReview = await hasSrpTierPermission(c.env, user.id, 'reviewer', user.is_admin)
	if (!canReview) {
		return c.json({ error: 'Requires SRP staff permissions' }, 403)
	}

	const { approvedAmount, reviewNotes } = validation.data

	const srpStub = getStub<Srp>(c.env.SRP, getRequestId(c))
	const existingRequest = await srpStub.getRequest(requestId, user.id)
	if (!existingRequest) return c.json({ error: 'Request not found' }, 404)
	const request = await srpStub.approveRequest(existingRequest.id, user.id, approvedAmount, reviewNotes)

	return c.json(request)
})

/**
 * Partially approve an SRP request
 * POST /api/srp/requests/:id/partially-approve
 */
srp.post('/requests/:id/partially-approve', async (c) => {
	const user = c.get('user')!
	const requestId = c.req.param('id')
	if (!isValidSrpRequestId(requestId)) {
		return c.json({ error: 'Invalid request id' }, 400)
	}
	const body = await c.req.json()

	// Validate request body
	const validation = PartiallyApproveRequestSchema.safeParse(body)
	if (!validation.success) {
		return c.json({ error: 'Invalid request data', details: validation.error }, 400)
	}

	// Check reviewer permissions
	const canReview = await hasSrpTierPermission(c.env, user.id, 'reviewer', user.is_admin)
	if (!canReview) {
		return c.json({ error: 'Requires SRP staff permissions' }, 403)
	}

	const { approvedAmount, rejectionReason, reviewNotes } = validation.data

	const srpStub = getStub<Srp>(c.env.SRP, getRequestId(c))
	const existingRequest = await srpStub.getRequest(requestId, user.id)
	if (!existingRequest) return c.json({ error: 'Request not found' }, 404)
	const request = await srpStub.partiallyApproveRequest(
		existingRequest.id,
		user.id,
		approvedAmount,
		rejectionReason,
		reviewNotes
	)

	return c.json(request)
})

/**
 * Reject an SRP request
 * POST /api/srp/requests/:id/reject
 */
srp.post('/requests/:id/reject', async (c) => {
	const user = c.get('user')!
	const requestId = c.req.param('id')
	if (!isValidSrpRequestId(requestId)) {
		return c.json({ error: 'Invalid request id' }, 400)
	}
	const body = await c.req.json()

	// Validate request body
	const validation = RejectRequestSchema.safeParse(body)
	if (!validation.success) {
		return c.json({ error: 'Invalid request data', details: validation.error }, 400)
	}

	// Check reviewer permissions
	const canReview = await hasSrpTierPermission(c.env, user.id, 'reviewer', user.is_admin)
	if (!canReview) {
		return c.json({ error: 'Requires SRP staff permissions' }, 403)
	}

	const { rejectionReason, reviewNotes } = validation.data

	const srpStub = getStub<Srp>(c.env.SRP, getRequestId(c))
	const existingRequest = await srpStub.getRequest(requestId, user.id)
	if (!existingRequest) return c.json({ error: 'Request not found' }, 404)
	const request = await srpStub.rejectRequest(
		existingRequest.id,
		user.id,
		rejectionReason,
		reviewNotes
	)

	return c.json(request)
})

/**
 * Submit a full review for a request
 * POST /api/srp/requests/:id/review
 */
srp.post('/requests/:id/review', async (c) => {
	const user = c.get('user')!
	const requestId = c.req.param('id')
	if (!isValidSrpRequestId(requestId)) {
		return c.json({ error: 'Invalid request id' }, 400)
	}
	const body = await c.req.json()

	const validation = SRPReviewSubmissionSchema.safeParse(body)
	if (!validation.success) {
		return c.json({ error: 'Invalid review data', details: validation.error }, 400)
	}

	const canReview = await hasSrpTierPermission(c.env, user.id, 'reviewer', user.is_admin)
	if (!canReview) return c.json({ error: 'Requires SRP staff permissions' }, 403)

	const srpStub = getStub<Srp>(c.env.SRP, getRequestId(c))
	const existingRequest = await srpStub.getRequest(requestId, user.id)
	if (!existingRequest) return c.json({ error: 'Request not found' }, 404)
	try {
		const request = await srpStub.submitReview(
			existingRequest.id,
			user.id,
			getPrimaryCharacterName(user),
			validation.data
		)
		return c.json(request)
	} catch (err: any) {
		if (err?.status === 422) return c.json({ error: err.message }, 422)
		throw err
	}
})

/**
 * Change the state of a request
 * PATCH /api/srp/requests/:id/state
 */
srp.patch('/requests/:id/state', async (c) => {
	const user = c.get('user')!
	const requestId = c.req.param('id')
	if (!isValidSrpRequestId(requestId)) {
		return c.json({ error: 'Invalid request id' }, 400)
	}
	const body = await c.req.json()

	const validation = UpdateReviewStateSchema.safeParse(body)
	if (!validation.success) {
		return c.json({ error: 'Invalid state data', details: validation.error }, 400)
	}

	const { newState, notes } = validation.data

	const requiredTier = newState === 'paid' || newState === 'payment_pending' ? 'payer' : 'reviewer'
	const hasRequiredTier = await hasSrpTierPermission(c.env, user.id, requiredTier, user.is_admin)
	if (!hasRequiredTier) {
		return c.json({
			error:
				requiredTier === 'payer'
					? 'Requires payer-or-higher permissions'
					: 'Requires reviewer-or-higher permissions',
		}, 403)
	}

	const srpStub = getStub<Srp>(c.env.SRP, getRequestId(c))
	const existingRequest = await srpStub.getRequest(requestId, user.id)
	if (!existingRequest) return c.json({ error: 'Request not found' }, 404)
	const request = await srpStub.updateReviewState(
		existingRequest.id,
		user.id,
		getPrimaryCharacterName(user),
		newState,
		notes
	)
	return c.json(request)
})

// =============================================================================
// COMMENTS
// =============================================================================

/**
 * Get comments for an SRP request
 * GET /api/srp/requests/:id/comments?includeInternal=false
 */
srp.get('/requests/:id/comments', async (c) => {
	const user = c.get('user')!
	const requestId = c.req.param('id')
	if (!isValidSrpRequestId(requestId)) {
		return c.json({ error: 'Invalid request id' }, 400)
	}
	const includeInternal = c.req.query('includeInternal') === 'true'

	// Verify access to request
	const srpStub = getStub<Srp>(c.env.SRP, getRequestId(c))
	const request = await srpStub.getRequest(requestId, user.id)

	if (!request) {
		return c.json({ error: 'Request not found' }, 404)
	}

	const hasSrpStaffPermission = await hasAnyPermission(c.env, user.id, SRP_ROLE_URNS, user.is_admin)
	if (request.userId !== user.id && !hasSrpStaffPermission) {
		return c.json({ error: 'Not authorized to view this request' }, 403)
	}

	const rawComments = await srpStub.getComments(
		request.id,
		user.id,
		hasSrpStaffPermission && includeInternal
	)
	const comments = await hydrateCommentAuthors(rawComments, c.env.DATABASE_URL, c.env, request.userId)
	return c.json(
		comments.map((comment) => ({
			...comment,
			requestId: request.id,
		}))
	)
})

/**
 * Add a comment to an SRP request
 * POST /api/srp/requests/:id/comments
 */
srp.post('/requests/:id/comments', async (c) => {
	const user = c.get('user')!
	const requestId = c.req.param('id')
	if (!isValidSrpRequestId(requestId)) {
		return c.json({ error: 'Invalid request id' }, 400)
	}
	const body = await c.req.json()

	// Validate request body
	const validation = CreateCommentSchema.safeParse(body)
	if (!validation.success) {
		return c.json({ error: 'Invalid comment data', details: validation.error }, 400)
	}

	// Verify access to request
	const srpStub = getStub<Srp>(c.env.SRP, getRequestId(c))
	const request = await srpStub.getRequest(requestId, user.id)

	if (!request) {
		return c.json({ error: 'Request not found' }, 404)
	}

	const hasSrpStaffPermission = await hasAnyPermission(c.env, user.id, SRP_ROLE_URNS, user.is_admin)
	if (request.userId !== user.id && !hasSrpStaffPermission) {
		return c.json({ error: 'Not authorized to comment on this request' }, 403)
	}

	const { content, visibility } = validation.data

	if (visibility === 'internal') {
		if (!hasSrpStaffPermission) {
			return c.json({ error: 'Not authorized to create internal comments' }, 403)
		}
	}

	const characterName = getPrimaryCharacterName(user)
	const comment = await srpStub.addComment(request.id, user.id, characterName, content, visibility)

	return c.json(
		{
			...comment,
			requestId: request.id,
		},
		201
	)
})

/**
 * Edit a comment
 * PATCH /api/srp/comments/:id
 */
srp.patch('/comments/:id', async (c) => {
	const user = c.get('user')!
	const commentId = c.req.param('id')
	const body = await c.req.json()

	// Validate request body
	const validation = EditCommentSchema.safeParse(body)
	if (!validation.success) {
		return c.json({ error: 'Invalid comment data', details: validation.error }, 400)
	}

	const { content } = validation.data

	const srpStub = getStub<Srp>(c.env.SRP, getRequestId(c))
	const comment = await srpStub.editComment(commentId, user.id, content)

	return c.json(comment)
})

/**
 * Delete a comment
 * DELETE /api/srp/comments/:id
 */
srp.delete('/comments/:id', async (c) => {
	const user = c.get('user')!
	const commentId = c.req.param('id')

	const srpStub = getStub<Srp>(c.env.SRP, getRequestId(c))
	await srpStub.deleteComment(commentId, user.id)

	return c.json({ success: true })
})

// =============================================================================
// PAYMENTS
// =============================================================================

/**
 * Get pending payments
 * GET /api/srp/payments/pending?corporationId=xxx&limit=50&offset=0
 *
 * Requires payer-or-higher permissions
 */
srp.get('/payments/pending', async (c) => {
	const user = c.get('user')!
	const corporationId = c.req.query('corporationId')
	const limit = c.req.query('limit') ? Number.parseInt(c.req.query('limit')!, 10) : 50
	const offset = c.req.query('offset') ? Number.parseInt(c.req.query('offset')!, 10) : 0

	const canPay = await hasSrpTierPermission(c.env, user.id, 'payer', user.is_admin)
	if (!canPay) {
		return c.json({ error: 'Requires payer-or-higher permissions' }, 403)
	}

	const srpStub = getStub<Srp>(c.env.SRP, getRequestId(c))
	const requestsRaw = await srpStub.getPendingPayments(corporationId, limit, offset)
	const requests = await enrichRequestsWithMilitarySrp(
		requestsRaw as RequestWithCharacterRole[],
		c.env
	)

	return c.json({
		requests,
		total: requests.length,
		limit,
		offset,
	})
})

/**
 * Get pending payout total for all unpaid approved requests
 * GET /api/srp/payments/pending-total?corporationId=xxx
 *
 * Requires payer-or-higher permissions
 */
srp.get('/payments/pending-total', async (c) => {
	const user = c.get('user')!
	const corporationId = c.req.query('corporationId')

	const canPay = await hasSrpTierPermission(c.env, user.id, 'payer', user.is_admin)
	if (!canPay) return c.json({ error: 'Requires payer-or-higher permissions' }, 403)

	const srpStub = getStub<Srp>(c.env.SRP, getRequestId(c))
	const pendingPayoutTotal = await srpStub.getPendingPayoutTotal(corporationId)

	return c.json({ pendingPayoutTotal })
})

/**
 * List payment mismatch alerts
 * GET /api/srp/alerts/payment-mismatches?includeAcknowledged=false&limit=50&offset=0
 */
srp.get('/alerts/payment-mismatches', async (c) => {
	const user = c.get('user')!
	const includeAcknowledged = c.req.query('includeAcknowledged') === 'true'
	const limit = c.req.query('limit') ? Number.parseInt(c.req.query('limit')!, 10) : 50
	const offset = c.req.query('offset') ? Number.parseInt(c.req.query('offset')!, 10) : 0

	const canPay = await hasSrpTierPermission(c.env, user.id, 'payer', user.is_admin)
	if (!canPay) return c.json({ error: 'Requires payer-or-higher permissions' }, 403)

	const srpStub = getStub<Srp>(c.env.SRP, getRequestId(c))
	const result = await srpStub.listPaymentMismatchAlerts({
		includeAcknowledged,
		limit,
		offset,
	})
	return c.json({
		...result,
		alerts: result.alerts,
	})
})

/**
 * Acknowledge payment mismatch alert
 * POST /api/srp/alerts/payment-mismatches/:id/acknowledge
 */
srp.post('/alerts/payment-mismatches/:id/acknowledge', async (c) => {
	const user = c.get('user')!
	const alertId = c.req.param('id')

	const canPay = await hasSrpTierPermission(c.env, user.id, 'payer', user.is_admin)
	if (!canPay) return c.json({ error: 'Requires payer-or-higher permissions' }, 403)

	const srpStub = getStub<Srp>(c.env.SRP, getRequestId(c))
	const alert = await srpStub.acknowledgePaymentMismatchAlert(
		alertId,
		user.id,
		getPrimaryCharacterName(user)
	)
	return c.json(alert)
})

/**
 * Mark a request as paid
 * POST /api/srp/requests/:id/mark-paid
 */
srp.post('/requests/:id/mark-paid', async (c) => {
	const user = c.get('user')!
	const requestId = c.req.param('id')
	if (!isValidSrpRequestId(requestId)) {
		return c.json({ error: 'Invalid request id' }, 400)
	}
	await c.req.json().catch(() => ({}))

	// Intentionally no admin bypass for payment submission mutations.
	const canPay = await hasSrpTierPermission(c.env, user.id, 'payer', false)
	if (!canPay) return c.json({ error: 'Requires payer-or-higher permissions' }, 403)

	const srpStub = getStub<Srp>(c.env.SRP, getRequestId(c))
	const existingRequest = await srpStub.getRequest(requestId, user.id)
	if (!existingRequest) return c.json({ error: 'Request not found' }, 404)
	const request = await srpStub.markPaid(
		existingRequest.id,
		user.id,
		getPrimaryCharacterName(user)
	)

	return c.json(request)
})

// =============================================================================
// CONFIGURATION
// =============================================================================

/**
 * Search active managed corporations for SRP payment processor selection
 * GET /api/srp/config/payment-processor-corporations/search?q=:query
 */
srp.get('/config/payment-processor-corporations/search', async (c) => {
	const user = c.get('user')!
	const query = c.req.query('q')?.trim()
	if (!query || query.length < 2) {
		return c.json({ error: 'q must be at least 2 characters' }, 400)
	}

	const canManage = await hasSrpTierPermission(c.env, user.id, 'manager', user.is_admin)
	if (!canManage) return c.json({ error: 'Requires manager-or-higher permissions' }, 403)

	const db = c.get('db')
	if (!db) return c.json({ error: 'Database unavailable' }, 500)

	const isNumeric = /^[0-9]+$/.test(query)
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
})

/**
 * Get SRP configuration
 * GET /api/srp/config
 */
srp.get('/config', async (c) => {
	const srpStub = getStub<Srp>(c.env.SRP, getRequestId(c))
	const config = await srpStub.getConfig()

	if (!config) {
		return c.json({ error: 'No configuration found' }, 404)
	}

	return c.json(config)
})

/**
 * Update SRP configuration
 * PATCH /api/srp/config
 */
srp.patch('/config', async (c) => {
	const user = c.get('user')!
	const body = await c.req.json()

	// Validate request body
	const validation = UpdateSRPConfigSchema.safeParse(body)
	if (!validation.success) {
		return c.json({ error: 'Invalid configuration data', details: validation.error }, 400)
	}

	const canManage = await hasSrpTierPermission(c.env, user.id, 'manager', user.is_admin)
	if (!canManage) return c.json({ error: 'Requires manager-or-higher permissions' }, 403)

	const srpStub = getStub<Srp>(c.env.SRP, getRequestId(c))
	const config = await srpStub.updateConfig(user.id, validation.data)

	return c.json(config)
})

// =============================================================================
// STATISTICS
// =============================================================================

/**
 * Get SRP statistics
 * GET /api/srp/stats?startDate=2024-01-01&endDate=2024-12-31&corporationId=xxx
 */
srp.get('/stats', async (c) => {
	const user = c.get('user')!
	const startDate = c.req.query('startDate')
	const endDate = c.req.query('endDate')
	const corporationId = c.req.query('corporationId')

	// TODO: Check permissions via Groups DO
	if (!user.is_admin) {
		return c.json({ error: 'Requires admin permissions' }, 403)
	}

	const srpStub = getStub<Srp>(c.env.SRP, getRequestId(c))
	const stats = await srpStub.getStats(startDate, endDate, corporationId)

	return c.json(stats)
})

// =============================================================================
// POLICIES
// =============================================================================

/**
 * List active policies (all reviewer+ roles)
 * GET /api/srp/policies
 */
srp.get('/policies', async (c) => {
	const user = c.get('user')!
	const canReview = await hasSrpTierPermission(c.env, user.id, 'reviewer', user.is_admin)
	if (!canReview) return c.json({ error: 'Requires SRP staff permissions' }, 403)

	const srpStub = getStub<Srp>(c.env.SRP, getRequestId(c))
	return c.json(await srpStub.listPolicies())
})

/**
 * Create a policy (manager only)
 * POST /api/srp/policies
 */
srp.post('/policies', async (c) => {
	const user = c.get('user')!
	const canManage = await hasSrpTierPermission(c.env, user.id, 'manager', user.is_admin)
	if (!canManage) return c.json({ error: 'Requires manager-or-higher permissions' }, 403)

	const body = await c.req.json()
	const validation = CreateSRPPolicySchema.safeParse(body)
	if (!validation.success)
		return c.json({ error: 'Invalid policy data', details: validation.error }, 400)

	const srpStub = getStub<Srp>(c.env.SRP, getRequestId(c))
	return c.json(await srpStub.createPolicy(user.id, validation.data), 201)
})

/**
 * Update a policy (manager only)
 * PATCH /api/srp/policies/:id
 */
srp.patch('/policies/:id', async (c) => {
	const user = c.get('user')!
	const canManage = await hasSrpTierPermission(c.env, user.id, 'manager', user.is_admin)
	if (!canManage) return c.json({ error: 'Requires manager-or-higher permissions' }, 403)

	const id = c.req.param('id')
	const body = await c.req.json()
	const validation = CreateSRPPolicySchema.partial().safeParse(body)
	if (!validation.success)
		return c.json({ error: 'Invalid policy data', details: validation.error }, 400)

	const srpStub = getStub<Srp>(c.env.SRP, getRequestId(c))
	return c.json(await srpStub.updatePolicy(id, user.id, validation.data))
})

/**
 * Delete (soft-delete) a policy (manager only)
 * DELETE /api/srp/policies/:id
 */
srp.delete('/policies/:id', async (c) => {
	const user = c.get('user')!
	const canManage = await hasSrpTierPermission(c.env, user.id, 'manager', user.is_admin)
	if (!canManage) return c.json({ error: 'Requires manager-or-higher permissions' }, 403)

	const id = c.req.param('id')
	const srpStub = getStub<Srp>(c.env.SRP, getRequestId(c))
	await srpStub.deletePolicy(id, user.id)
	return c.json({ ok: true })
})

export default srp
