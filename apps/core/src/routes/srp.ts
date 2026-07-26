import { Hono } from 'hono'
import { z } from 'zod'

import { and, asc, desc, eq, ilike, inArray, or, sql } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'
import {
	CreateCommentSchema,
	CreateSRPPolicySchema,
	CreateSRPRequestSchema,
	EditCommentSchema,
	REQUEST_STATUSES,
	SRPReviewSubmissionSchema,
	UpdateReviewStateSchema,
	UpdateSRPConfigSchema,
	WithdrawSRPRequestSchema,
} from '@repo/srp'
import { buildCsvLine, createR2MultipartTextWriter, parseDateOrNull } from '@repo/worker-utils'
import { createWorkflow } from '@repo/workflow-utils'

import { createDb } from '../db'
import { discordServers, managedCorporations, userCharacters } from '../db/schema'
import { isExportArtifactExpired } from '../lib/export-retention'
import { getCachedUserPermissions } from '../lib/groups-cache'
import { normalizeWorkflowStatus } from '../lib/workflow-status'
import { validatePagination } from '../lib/validation'
import { requireAllianceMember } from '../middleware/session'

import type { Doctrines, FittingWithItems } from '@repo/doctrines'
import type { EsiTypeResolver } from '@repo/esi'
import type {
	LossWithSRPStatus,
	SRPCommentResponse,
	SRPRequestResponse,
	RecentLossRefreshCoordinator,
	RequestStatus,
	Srp,
} from '@repo/srp'
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
const VerifyPaidManuallySchema = z.object({}).passthrough()

const ReviewQueueStatusQuerySchema = z.enum([
	'pending',
	'needs_context',
	'approved',
	'payment_pending',
	'rejected',
	'paid',
])
const RequestSearchFieldQuerySchema = z.enum(['character', 'ship', 'system'])
const WalletHistorySearchFieldQuerySchema = z.enum(['reason', 'recipient'])
const SRP_REQUEST_ID_IN_REASON_REGEX = /KM#(\d+)/i

/** Get the primary character name for the session user */
function getPrimaryCharacterName(user: any): string {
	return user.characters.find((c: any) => c.is_primary)?.characterName ?? 'Unknown'
}

const SRP_ROLE_URNS = ['urn:srp:reviewer', 'urn:srp:payer', 'urn:srp:manager']
const SRP_REQUEST_ID_PATTERN = /^\d+$/
const SRP_CSV_EXPORT_MAX_RANGE_YEARS = 1

function getExecutionContextOrNull(c: { executionCtx?: ExecutionContext }): ExecutionContext | null {
	try {
		return c.executionCtx ?? null
	} catch {
		return null
	}
}

type UserRequestListResult = Awaited<ReturnType<Srp['getUserRequests']>>
type NormalizedUserRequestListResult = {
	requests: SRPRequestResponse[]
	total: number
}

function normalizeUserRequestListResult(
	result: UserRequestListResult | SRPRequestResponse[]
): NormalizedUserRequestListResult {
	if (Array.isArray(result)) {
		return {
			requests: result,
			total: result.length,
		}
	}

	return result
}

function isValidSrpRequestId(requestId: string): boolean {
	return SRP_REQUEST_ID_PATTERN.test(requestId)
}

function normalizeUtcStartOfDay(date: Date): Date {
	return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0))
}

function normalizeUtcEndOfDay(date: Date): Date {
	return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999))
}

export function parseSrpCsvExportDateRange(dateFromRaw: string | undefined, dateToRaw: string | undefined): {
	dateFrom: string
	dateTo: string
	startDate: Date
	endDate: Date
} | { error: string } {
	if (!dateFromRaw || !dateToRaw) {
		return { error: 'dateFrom and dateTo must be selected for CSV export' }
	}

	const dateFrom = parseDateOrNull(dateFromRaw)
	const dateTo = parseDateOrNull(dateToRaw)
	if (!dateFrom || !dateTo) {
		return { error: 'dateFrom and dateTo must be valid dates' }
	}

	const startDate = normalizeUtcStartOfDay(dateFrom)
	const endDate = normalizeUtcEndOfDay(dateTo)
	if (endDate < startDate) {
		return { error: 'dateTo must be on or after dateFrom' }
	}

	const maxEndDate = normalizeUtcEndOfDay(new Date(startDate.getTime()))
	maxEndDate.setUTCFullYear(maxEndDate.getUTCFullYear() + SRP_CSV_EXPORT_MAX_RANGE_YEARS)
	if (endDate > maxEndDate) {
		return { error: 'CSV export date range cannot exceed 1 year' }
	}

	return {
		dateFrom: dateFromRaw,
		dateTo: dateToRaw,
		startDate,
		endDate,
	}
}

async function enrichRequestsWithSystemRegions<T extends SRPRequestResponse>(
	requests: T[],
	env: { UNIVERSE: DurableObjectNamespace }
): Promise<T[]> {
	if (requests.length === 0) return requests
	const systemIds = [...new Set(requests.map((request) => request.solarSystemId).filter(Boolean))] as string[]
	if (systemIds.length === 0) return requests

	const universeStub = getStub<Universe>(env.UNIVERSE, 'default')
	const systemsById = await universeStub.resolveSolarSystemsByIds(systemIds)
	const regionIds = [
		...new Set(
			Object.values(systemsById)
				.map((system) => system?.regionId)
				.filter((value): value is string => Boolean(value))
		),
	]
	const regionsById =
		regionIds.length > 0 ? await universeStub.resolveRegionsByIds(regionIds) : {}

	return requests.map((request) => {
		const system = request.solarSystemId ? systemsById[request.solarSystemId] : null
		const region = system?.regionId ? regionsById[system.regionId] : null
		return {
			...request,
			solarSystemRegionName: region?.regionName ?? undefined,
		}
	})
}

async function enrichLossesWithSystemRegions<T extends LossWithSRPStatus>(
	losses: T[],
	env: { UNIVERSE: DurableObjectNamespace }
): Promise<T[]> {
	if (losses.length === 0) return losses
	const systemIds = [...new Set(losses.map((loss) => loss.solarSystemId).filter(Boolean))] as string[]
	if (systemIds.length === 0) return losses

	const universeStub = getStub<Universe>(env.UNIVERSE, 'default')
	const systemsById = await universeStub.resolveSolarSystemsByIds(systemIds)
	const regionIds = [
		...new Set(
			Object.values(systemsById)
				.map((system) => system?.regionId)
				.filter((value): value is string => Boolean(value))
		),
	]
	const regionsById =
		regionIds.length > 0 ? await universeStub.resolveRegionsByIds(regionIds) : {}

	return losses.map((loss) => {
		const system = loss.solarSystemId ? systemsById[loss.solarSystemId] : null
		const region = system?.regionId ? regionsById[system.regionId] : null
		return {
			...loss,
			solarSystemRegionName: region?.regionName ?? undefined,
		}
	})
}

/** Hydrate authorCharacterName, authorCharacterId, and authorRole on comments */
async function hydrateCommentAuthors(
	comments: SRPCommentResponse[],
	databaseUrl: string,
	env: { GROUPS: DurableObjectNamespace },
	requestDetails: {
		requestUserId: string
		requestCharacterId: string
		requestCharacterName: string
	}
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
	const requestorMainCharacterId = charMap[requestDetails.requestUserId]?.characterId
	const requestorCharacterRole =
		requestorMainCharacterId && requestorMainCharacterId === requestDetails.requestCharacterId
			? ('main' as const)
			: ('alt' as const)

	// Determine SRP staff role for each non-requestor author
	const nonRequestorIds = userIds.filter((id) => id !== requestDetails.requestUserId)
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
		authorCharacterName:
			c.authorUserId === requestDetails.requestUserId
				? requestDetails.requestCharacterName
				: (charMap[c.authorUserId]?.name ?? c.authorCharacterName),
		authorCharacterId:
			c.authorUserId === requestDetails.requestUserId
				? requestDetails.requestCharacterId
				: charMap[c.authorUserId]?.characterId,
		authorMainCharacterName: charMap[c.authorUserId]?.name,
		authorMainCharacterId: charMap[c.authorUserId]?.characterId,
		authorCharacterRole:
			c.authorUserId === requestDetails.requestUserId ? requestorCharacterRole : undefined,
		authorRole:
			c.authorUserId === requestDetails.requestUserId
				? 'requestor'
				: staffSet.has(c.authorUserId)
					? 'staff'
					: undefined,
	}))
}

type RequestWithCharacterRole = SRPRequestResponse & {
	characterRole?: 'main' | 'alt'
	mainCharacterId?: string
	mainCharacterName?: string
}
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
			characterName: userCharacters.characterName,
		})
		.from(userCharacters)
		.where(and(eq(userCharacters.is_primary, true), inArray(userCharacters.userId, userIds)))

	const mainCharacterByUserId = new Map(
		rows.map((row) => [row.userId, { characterId: row.characterId, characterName: row.characterName }])
	)

	return requests.map((request) => {
		const mainCharacter = mainCharacterByUserId.get(request.userId)
		if (!mainCharacter) return request
		return {
			...request,
			characterRole: request.characterId === mainCharacter.characterId ? 'main' : 'alt',
			mainCharacterId: mainCharacter.characterId,
			mainCharacterName: mainCharacter.characterName,
		}
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
 * Get recent losses for all user's characters with SRP status.
 * The backend configuration is the source of truth for the lookback window.
 */
srp.get('/losses', async (c) => {
	const user = c.get('user')!
	const srpStub = getStub<Srp>(c.env.SRP, 'default')
	const config = await srpStub.getConfig()
	const configuredLookbackDays = config?.maxLossAgeDays ?? 30
	const limitRaw = c.req.query('limit')
	const offsetRaw = c.req.query('offset')
	const pagination =
		limitRaw !== undefined || offsetRaw !== undefined
			? validatePagination(limitRaw, offsetRaw)
			: null
	if (pagination && !pagination.success) {
		return c.json({ error: pagination.error }, pagination.status)
	}

	// Get all character IDs for the user
	const characters = user.characters.map((char) => ({
		characterId: char.characterId,
		characterName: char.characterName,
	}))

	if (characters.length === 0) {
		return c.json({
			losses: [],
			failedCharacters: [],
			total: 0,
			limit: 0,
			offset: 0,
		})
	}

	const result = await srpStub.getRecentLosses(
		characters,
		user.id,
		configuredLookbackDays,
		true,
		pagination?.data.limit,
		pagination?.data.offset
	)
	const losses = result.losses
		.sort((a, b) => new Date(b.killmailTime).getTime() - new Date(a.killmailTime).getTime())
	const failedCharacters = result.failedCharacters
	const characterNameById = new Map(
		user.characters.map((character) => [character.characterId, character.characterName])
	)
	const lossesWithCharacterNames = losses.map((loss) => ({
		...loss,
		victimCharacterName: characterNameById.get(loss.victimCharacterId) ?? undefined,
	}))
	const lossesWithRegions = await enrichLossesWithSystemRegions(lossesWithCharacterNames, c.env)

	return c.json({
		losses: lossesWithRegions,
		failedCharacters,
		total: result.total,
		limit: result.limit,
		offset: result.offset,
	})
})

/**
 * Dismiss a recent loss from the user's SRP losses list.
 * POST /api/srp/losses/:killmailId/dismiss
 */
srp.post('/losses/:killmailId/dismiss', async (c) => {
	const user = c.get('user')
	if (!user?.id) {
		return c.json({ error: 'Authentication required' }, 401)
	}

	const killmailId = c.req.param('killmailId')
	if (!killmailId || !/^\d+$/.test(killmailId)) {
		return c.json({ error: 'Invalid killmail id' }, 400)
	}

	const srpStub = getStub<Srp>(c.env.SRP, 'default')
	await srpStub.dismissLoss(user.id, killmailId)
	return c.json({ success: true })
})

/**
 * Trigger killmail refresh for all of the user's characters
 * POST /api/srp/losses/refresh
 * Starts the background workflow and returns its handle for polling.
 */
srp.post('/losses/refresh', async (c) => {
	const user = c.get('user')!
	const srpStub = getStub<Srp>(c.env.SRP, 'default')
	const refreshCoordinator = getStub<RecentLossRefreshCoordinator>(
		c.env.SRP_RECENT_LOSS_REFRESH_COORDINATOR,
		user.id
	)
	const config = await srpStub.getConfig()
	const refreshAttempt = await refreshCoordinator.startRecentLossRefresh(
		user.id,
		user.characters.map((char) => ({
			characterId: char.characterId,
			characterName: char.characterName,
		})),
		config?.maxLossAgeDays ?? 30
	)
	if (!refreshAttempt.allowed) {
		c.header('Retry-After', String(Math.max(1, Math.ceil(refreshAttempt.retryAfterMs / 1000))))
		return c.json(
			{
				error: 'Recent loss refresh is on cooldown',
				retryAfterMs: refreshAttempt.retryAfterMs,
				cooldownUntil: refreshAttempt.cooldownUntil,
			},
			429
		)
	}
	return c.json(refreshAttempt)
})

/**
 * Get the status of the current or most recent recent-loss refresh workflow.
 * GET /api/srp/losses/refresh/status
 */
srp.get('/losses/refresh/status', async (c) => {
	const user = c.get('user')!
	const statusStub = getStub<RecentLossRefreshCoordinator>(
		c.env.SRP_RECENT_LOSS_REFRESH_COORDINATOR,
		user.id
	)
	const status = await statusStub.getRecentLossRefreshStatus(user.id)
	return c.json(status)
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

	const srpStub = getStub<Srp>(c.env.SRP, 'default')
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

	const srpStub = getStub<Srp>(c.env.SRP, 'default')
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
	const pagination = validatePagination(c.req.query('limit'), c.req.query('offset'))
	if (!pagination.success) {
		return c.json({ error: pagination.error }, pagination.status)
	}
	const statusQuery = c.req.query('status')?.trim()
	if (statusQuery && !REQUEST_STATUSES.includes(statusQuery as RequestStatus)) {
		return c.json({ error: 'Invalid status' }, 400)
	}

	const srpStub = getStub<Srp>(c.env.SRP, 'default')
	const requestsRaw = normalizeUserRequestListResult(
		await srpStub.getUserRequests(
			user.id,
			pagination.data.limit,
			pagination.data.offset,
			statusQuery ? (statusQuery as RequestStatus) : undefined
		)
	)
	const withCharacterRoles = await hydrateRequestCharacterRoles(
		requestsRaw.requests as RequestWithCharacterRole[],
		c.env.DATABASE_URL
	)
	const withSystemRegions = await enrichRequestsWithSystemRegions(withCharacterRoles, c.env)
	const requests = await enrichRequestsWithMilitarySrp(withSystemRegions, c.env)

	return c.json({
		requests,
		total: requestsRaw.total,
		limit: pagination.data.limit,
		offset: pagination.data.offset,
	})
})

/**
 * Get requests by status (reviewer queue)
 * GET /api/srp/requests/by-status?status=pending&limit=50&offset=0
 */
srp.get('/requests/by-status', async (c) => {
	const user = c.get('user')!
	const statusParsed = ReviewQueueStatusQuerySchema.safeParse(c.req.query('status'))
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

	const srpStub = getStub<Srp>(c.env.SRP, 'default')
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
	const withSystemRegions = await enrichRequestsWithSystemRegions(withCharacterRoles, c.env)
	const requests = await enrichRequestsWithMilitarySrp(withSystemRegions, c.env)
	return c.json({
		requests,
		total: result.total,
		limit,
		offset,
	})
})

/**
 * Get a count of SRP requests by status without fetching rows.
 * GET /api/srp/requests/by-status/count?status=pending
 */
srp.get('/requests/by-status/count', async (c) => {
	const user = c.get('user')!
	const statusParsed = ReviewQueueStatusQuerySchema.safeParse(c.req.query('status'))
	if (!statusParsed.success) {
		return c.json({ error: 'Invalid status' }, 400)
	}

	const characterName = c.req.query('characterName')?.trim() || undefined
	const shipTypeName = c.req.query('shipTypeName')?.trim() || undefined
	const solarSystemName = c.req.query('solarSystemName')?.trim() || undefined
	const dateFrom = c.req.query('dateFrom')?.trim() || undefined
	const dateTo = c.req.query('dateTo')?.trim() || undefined

	const canAccessCount =
		statusParsed.data === 'approved'
			? await hasSrpTierPermission(c.env, user.id, 'payer', user.is_admin)
			: await hasSrpTierPermission(c.env, user.id, 'reviewer', user.is_admin)
	if (!canAccessCount) return c.json({ error: 'Requires SRP staff permissions' }, 403)

	const srpStub = getStub<Srp>(c.env.SRP, 'default')
	const total = await srpStub.getRequestCountByStatus(statusParsed.data, {
		characterName,
		shipTypeName,
		solarSystemName,
		dateFrom,
		dateTo,
	})

	return c.json({ total })
})

/**
 * Get search values for review queue filters
 * GET /api/srp/requests/search-values?status=pending&field=character&query=ab
 */
srp.get('/requests/search-values', async (c) => {
	const user = c.get('user')!
	const statusParsed = ReviewQueueStatusQuerySchema.safeParse(c.req.query('status'))
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

	const srpStub = getStub<Srp>(c.env.SRP, 'default')
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

	const srpStub = getStub<Srp>(c.env.SRP, 'default')
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
			{
				requestUserId: request.userId,
				requestCharacterId: request.characterId,
				requestCharacterName: request.characterName,
			}
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
	const [requestWithSystemRegion] = await enrichRequestsWithSystemRegions(
		[requestWithCharacterRole],
		c.env
	)
	const [militaryEnrichedRequest] = await enrichRequestsWithMilitarySrp(
		[requestWithSystemRegion],
		c.env
	)
	return c.json(militaryEnrichedRequest)
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

	const srpStub = getStub<Srp>(c.env.SRP, 'default')
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

	const srpStub = getStub<Srp>(c.env.SRP, 'default')
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

	const srpStub = getStub<Srp>(c.env.SRP, 'default')
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

	const srpStub = getStub<Srp>(c.env.SRP, 'default')
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

	const srpStub = getStub<Srp>(c.env.SRP, 'default')
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

	const srpStub = getStub<Srp>(c.env.SRP, 'default')
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

/**
 * Withdraw a request (requestor only)
 * POST /api/srp/requests/:id/withdraw
 */
srp.post('/requests/:id/withdraw', async (c) => {
	const user = c.get('user')!
	const requestId = c.req.param('id')
	if (!isValidSrpRequestId(requestId)) {
		return c.json({ error: 'Invalid request id' }, 400)
	}
	const body = await c.req.json().catch(() => ({}))

	const validation = WithdrawSRPRequestSchema.safeParse(body)
	if (!validation.success) {
		return c.json({ error: 'Invalid request data', details: validation.error }, 400)
	}

	const srpStub = getStub<Srp>(c.env.SRP, 'default')
	const existingRequest = await srpStub.getRequest(requestId, user.id)
	if (!existingRequest) return c.json({ error: 'Request not found' }, 404)
	if (existingRequest.userId !== user.id) {
		return c.json({ error: 'Not authorized to withdraw this request' }, 403)
	}

	try {
		const request = await srpStub.withdrawRequest(
			existingRequest.id,
			user.id,
			getPrimaryCharacterName(user),
			validation.data.notes
		)
		return c.json(request)
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		if (message.includes('Only pending or needs_context requests can be withdrawn')) {
			return c.json({ error: message }, 422)
		}
		throw error
	}
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
	const srpStub = getStub<Srp>(c.env.SRP, 'default')
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
	const comments = await hydrateCommentAuthors(rawComments, c.env.DATABASE_URL, c.env, {
		requestUserId: request.userId,
		requestCharacterId: request.characterId,
		requestCharacterName: request.characterName,
	})
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
	const srpStub = getStub<Srp>(c.env.SRP, 'default')
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

	const characterName =
		request.userId === user.id ? request.characterName : getPrimaryCharacterName(user)
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

	const srpStub = getStub<Srp>(c.env.SRP, 'default')
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

	const srpStub = getStub<Srp>(c.env.SRP, 'default')
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

	const srpStub = getStub<Srp>(c.env.SRP, 'default')
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

	const srpStub = getStub<Srp>(c.env.SRP, 'default')
	const pendingPayoutTotal = await srpStub.getPendingPayoutTotal(corporationId)

	return c.json({ pendingPayoutTotal })
})

const SRP_EXPORT_BUCKET_PREFIX = 'srp-exports'

export function getSrpExportBucket(env: App['Bindings']): R2Bucket {
	return env.SRP_EXPORTS
}

export interface SrpCsvExportDateRange {
	dateFrom: string
	dateTo: string
	startDate: Date
	endDate: Date
}

export interface SrpPaidRequestsExportFilters {
	characterName?: string
	shipTypeName?: string
	solarSystemName?: string
	dateRange: SrpCsvExportDateRange
}

export interface SrpWalletHistoryExportFilters {
	reason?: string
	recipientId?: string
	alertsOnly?: boolean
	dateRange: SrpCsvExportDateRange
}

export function buildSrpPaidRequestsExportKey(exportId: string): string {
	return `${SRP_EXPORT_BUCKET_PREFIX}/paid-requests/${exportId}.csv`
}

export function buildSrpPaidRequestsExportFileName(dateFrom: string, dateTo: string): string {
	return `srp-paid-requests-${dateFrom.slice(0, 10)}-${dateTo.slice(0, 10)}.csv`
}

export function buildSrpWalletHistoryExportKey(exportId: string): string {
	return `${SRP_EXPORT_BUCKET_PREFIX}/wallet-history/${exportId}.csv`
}

export function buildSrpWalletHistoryExportFileName(dateFrom: string, dateTo: string): string {
	return `srp-wallet-history-${dateFrom.slice(0, 10)}-${dateTo.slice(0, 10)}.csv`
}

function serializeWalletHistoryEntryDate(value: unknown): string {
	if (value == null) {
		return ''
	}
	if (typeof value === 'string') {
		const parsed = parseDateOrNull(value)
		if (parsed) return parsed.toISOString()
	}
	if (typeof value === 'number' && Number.isFinite(value)) {
		return new Date(value).toISOString()
	}
	if (value && typeof value === 'object') {
		try {
			const rawValue = (value as { valueOf?: () => unknown }).valueOf?.()
			if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
				return new Date(rawValue).toISOString()
			}
			if (typeof rawValue === 'string') {
				const parsed = parseDateOrNull(rawValue)
				if (parsed) return parsed.toISOString()
			}
		} catch {
			// Fall through to the generic parse/error path below.
		}
		try {
			const jsonValue = JSON.stringify(value)
			if (jsonValue) {
				const unquotedValue = jsonValue.startsWith('"') && jsonValue.endsWith('"')
					? jsonValue.slice(1, -1)
					: jsonValue
				const parsed = parseDateOrNull(unquotedValue)
				if (parsed) return parsed.toISOString()
			}
		} catch {
			// Fall through to the generic parse/error path below.
		}
		if ('toISOString' in value) {
			try {
				return (value as { toISOString: () => string }).toISOString()
			} catch {
				// Fall through to the generic parse/error path below.
			}
		}
	}
	const parsed = parseDateOrNull(String(value))
	if (parsed) return parsed.toISOString()
	throw new Error(`Invalid wallet history entry date: ${String(value)}`)
}

function buildSrpWalletHistoryWhereClause(args: {
	processorCorporationId: string
	reason?: string
	recipientId?: string
	dateFrom?: string
	dateTo?: string
}) {
	const whereParts = [
		sql`wj.corporation_id = ${args.processorCorporationId}`,
		sql`wj.ref_type = 'corporation_account_withdrawal'`,
		sql`exists (
			select 1
			from user_characters recipient_char
			where recipient_char.character_id = wj.second_party_id
		)`,
	]

	if (args.reason) whereParts.push(sql`wj.reason ilike ${`%${args.reason}%`}`)
	if (args.recipientId) whereParts.push(sql`wj.second_party_id = ${args.recipientId}`)
	if (args.dateFrom) {
		whereParts.push(
			sql`wj.date >= ${args.dateFrom.includes('T') ? new Date(args.dateFrom) : new Date(`${args.dateFrom}T00:00:00.000Z`)}`
		)
	}
	if (args.dateTo) {
		whereParts.push(
			sql`wj.date <= ${args.dateTo.includes('T') ? new Date(args.dateTo) : new Date(`${args.dateTo}T23:59:59.999Z`)}`
		)
	}

	return sql.join(whereParts, sql` and `)
}

function buildSrpWalletHistoryBaseCte(args: {
	processorCorporationId: string
	whereClause: unknown
}) {
	return sql`
		with wallet_history_base as (
			select
				wj.journal_id::text as "journalId",
				wj.ref_type as "refType",
				wj.amount as "amount",
				wj.reason as "reason",
				wj.second_party_id::text as "recipientId",
				wj.date as "entryDate",
				request_ref.request_id_from_reason as "requestIdFromReason",
				req.id::text as "linkedRequestId",
				req.character_id as "expectedRequestCharacterId",
				coalesce(
					(
						wj.ref_type = 'corporation_account_withdrawal'
						and wj.second_party_id is not null
						and (wj.reason is null or btrim(wj.reason) = '')
					),
					false
				) as "hasMissingReasonWarning",
				coalesce(
					req.character_id is not null
					and wj.second_party_id is not null
					and wj.second_party_id::text <> req.character_id,
					false
				) as "hasRecipientMismatch",
				(
					coalesce(alert_counts.open_alert_count, 0) > 0
					or (
						req.character_id is not null
						and wj.second_party_id is not null
						and wj.second_party_id::text <> req.character_id
					)
				) as "hasOpenAlert"
			from corporation_wallet_journal as wj
			left join lateral (
				select (regexp_match(coalesce(wj.reason, ''), 'KM#([0-9]+)'))[1] as request_id_from_reason
			) as request_ref on true
			left join srp_requests as req on req.id = request_ref.request_id_from_reason
			left join (
				select
					journal_id::text as journal_id,
					count(*)::int as open_alert_count
				from srp_payment_alerts
				where payment_processor_corporation_id = ${args.processorCorporationId}
					and state = 'open'
				group by journal_id
			) as alert_counts on alert_counts.journal_id = wj.journal_id::text
			where ${args.whereClause}
		)
	`
}

function buildSrpWalletHistoryRowsQuery(args: {
	processorCorporationId: string
	whereClause: unknown
	alertsOnly: boolean
	limit: number
	offset: number
}) {
	const baseCte = buildSrpWalletHistoryBaseCte({
		processorCorporationId: args.processorCorporationId,
		whereClause: args.whereClause,
	})
	const alertFilter = args.alertsOnly ? sql`where "hasOpenAlert" or "hasMissingReasonWarning"` : sql``

	return sql`
		${baseCte}
		select
			"journalId",
			"refType",
			"amount",
			"reason",
			"recipientId",
			"entryDate",
			"requestIdFromReason",
			"linkedRequestId",
			"expectedRequestCharacterId",
			"hasRecipientMismatch",
			"hasMissingReasonWarning",
			"hasOpenAlert"
		from wallet_history_base
		${alertFilter}
		order by "entryDate" desc, "journalId" desc
		limit ${args.limit}
		offset ${args.offset}
	`
}

function buildSrpWalletHistoryCountQuery(args: {
	processorCorporationId: string
	whereClause: unknown
	alertsOnly: boolean
}) {
	const baseCte = buildSrpWalletHistoryBaseCte({
		processorCorporationId: args.processorCorporationId,
		whereClause: args.whereClause,
	})
	const alertFilter = args.alertsOnly ? sql`where "hasOpenAlert" or "hasMissingReasonWarning"` : sql``

	return sql`
		${baseCte}
		select cast(count(*) as integer) as "total"
		from wallet_history_base
		${alertFilter}
	`
}

type WalletHistoryRow = {
	journalId: string
	refType: string | null
	amount: string
	reason: string | null
	recipientId: string | null
	entryDate: Date
	requestIdFromReason: string | null
	linkedRequestId: string | null
	expectedRequestCharacterId: string | null
	hasRecipientMismatch: boolean
	hasMissingReasonWarning: boolean
	hasOpenAlert: boolean
}

export async function writeSrpPaidRequestsExportToBucket(args: {
	bucket: R2Bucket
	exportKey: string
	fileName: string
	expiresAt: string
	env: App['Bindings']
	filters: SrpPaidRequestsExportFilters
}): Promise<number> {
	const writer = await createR2MultipartTextWriter(args.bucket, args.exportKey, {
		httpMetadata: {
			contentType: 'text/csv; charset=utf-8',
		},
		customMetadata: {
			fileName: args.fileName,
			expiresAt: args.expiresAt,
		},
	})

	const srpStub = getStub<Srp>(args.env.SRP, 'default')
	let rowCount = 0

	try {
		await writer.writeLine(
			buildCsvLine([
				'userId',
				'losingCharacterId',
				'losingCharacterName',
				'shipTypeId',
				'shipTypeName',
				'srpCapType',
				'payoutModifierType',
				'fullValue',
				'paidValue',
			])
		)

		const pageSize = 200
		let offset = 0
		for (;;) {
			const result = await srpStub.getRequestsByStatus('paid', {
				limit: pageSize,
				offset,
				characterName: args.filters.characterName,
				shipTypeName: args.filters.shipTypeName,
				solarSystemName: args.filters.solarSystemName,
				dateFrom: args.filters.dateRange.startDate.toISOString(),
				dateTo: args.filters.dateRange.endDate.toISOString(),
			})
			for (const request of result.requests) {
				await writer.writeLine(
					buildCsvLine([
						request.userId,
						request.characterId,
						request.characterName,
						request.shipTypeId,
						request.shipTypeName,
						request.appliedCapPolicyName ?? 'None',
						request.appliedModifierPolicyName ?? 'None',
						request.shipValue,
						request.approvedAmount ?? '',
					])
				)
				rowCount += 1
			}
			if (result.requests.length < pageSize || rowCount >= result.total) {
				break
			}
			offset += pageSize
		}

		await writer.close()
		return rowCount
	} catch (error) {
		await writer.abort().catch(() => {})
		throw error
	}
}

export async function writeSrpWalletHistoryExportToBucket(args: {
	bucket: R2Bucket
	exportKey: string
	fileName: string
	expiresAt: string
	env: App['Bindings']
	filters: SrpWalletHistoryExportFilters
}): Promise<number> {
	const writer = await createR2MultipartTextWriter(args.bucket, args.exportKey, {
		httpMetadata: {
			contentType: 'text/csv; charset=utf-8',
		},
		customMetadata: {
			fileName: args.fileName,
			expiresAt: args.expiresAt,
		},
	})

	const srpStub = getStub<Srp>(args.env.SRP, 'default')
	const config = await srpStub.getConfig()
	const processorCorporationId = config?.paymentProcessorCorporationId?.trim() ?? ''
	if (!processorCorporationId) {
		await writer.abort().catch(() => {})
		throw new Error('SRP payment processor corporation is not configured')
	}

	const db = createDb(args.env.DATABASE_URL)
	let rowCount = 0
	const whereParts = [
		sql`corporation_id = ${processorCorporationId}`,
		sql`ref_type = 'corporation_account_withdrawal'`,
		sql`exists (
			select 1
			from user_characters recipient_char
			where recipient_char.character_id = second_party_id
		)`,
	]
	if (args.filters.reason) whereParts.push(sql`reason ilike ${`%${args.filters.reason}%`}`)
	if (args.filters.recipientId) whereParts.push(sql`second_party_id = ${args.filters.recipientId}`)
	whereParts.push(
		sql`date >= ${args.filters.dateRange.startDate}`,
		sql`date <= ${args.filters.dateRange.endDate}`,
	)
	const whereClause = sql.join(whereParts, sql` and `)

	const [rowsResult, matchingRequestsResult, paymentAlertsResult] = await Promise.all([
		db.execute<{
			journalId: string
			refType: string | null
			amount: string
			reason: string | null
			recipientId: string | null
			entryDate: Date
		}>(sql`select
				journal_id::text as "journalId",
				ref_type as "refType",
				amount as "amount",
				reason as "reason",
				second_party_id as "recipientId",
				date as "entryDate"
			from corporation_wallet_journal
			where ${whereClause}
			order by date desc`),
		db.execute<{ id: string; characterId: string }>(
			sql`select id::text as "id", character_id as "characterId"
				from srp_requests
				where id in (
					select distinct substring(coalesce(reason, '') from 'KM#([0-9]+)')::text
					from corporation_wallet_journal
					where ${whereClause}
						and reason ~ 'KM#[0-9]+'
				)`
		).catch(() => ({ rows: [] as Array<{ id: string; characterId: string }> })),
		db.execute<{
			journalId: string
			kind: string
			state: string
			expectedAmount: string | null
			observedAmount: string | null
			expectedRecipientCharacterId: string | null
			expectedRecipientCharacterName: string | null
			actualRecipientCharacterId: string | null
			actualRecipientCharacterName: string | null
		}>(sql`select
				journal_id::text as "journalId",
				kind,
				state,
				expected_amount as "expectedAmount",
				observed_amount as "observedAmount",
				expected_recipient_character_id as "expectedRecipientCharacterId",
				expected_recipient_character_name as "expectedRecipientCharacterName",
				actual_recipient_character_id as "actualRecipientCharacterId",
				actual_recipient_character_name as "actualRecipientCharacterName"
			from srp_payment_alerts
			where journal_id in (
				select journal_id
				from corporation_wallet_journal
				where ${whereClause}
			)`).catch(() => ({
			rows: [] as Array<{
				journalId: string
				kind: string
				state: string
				expectedAmount: string | null
				observedAmount: string | null
				expectedRecipientCharacterId: string | null
				expectedRecipientCharacterName: string | null
				actualRecipientCharacterId: string | null
				actualRecipientCharacterName: string | null
			}>,
		})),
	])

	const requestById = new Map(
		(matchingRequestsResult.rows ?? []).map((row) => [row.id, row.characterId])
	)
	const alertKindsByJournalId = new Map<string, string[]>()
	const paymentAlertDetailByJournalId = new Map<
		string,
		{
			expectedAmount: string | null
			observedAmount: string | null
			expectedRecipientCharacterId: string | null
			expectedRecipientCharacterName: string | null
			actualRecipientCharacterId: string | null
			actualRecipientCharacterName: string | null
		}
	>()
	for (const row of paymentAlertsResult.rows ?? []) {
		const existing = alertKindsByJournalId.get(row.journalId) ?? []
		if (row.state === 'open' && !existing.includes(row.kind)) {
			existing.push(row.kind)
			alertKindsByJournalId.set(row.journalId, existing)
		}
		if (row.state === 'open' && !paymentAlertDetailByJournalId.has(row.journalId)) {
			paymentAlertDetailByJournalId.set(row.journalId, {
				expectedAmount: row.expectedAmount,
				observedAmount: row.observedAmount,
				expectedRecipientCharacterId: row.expectedRecipientCharacterId,
				expectedRecipientCharacterName: row.expectedRecipientCharacterName,
				actualRecipientCharacterId: row.actualRecipientCharacterId,
				actualRecipientCharacterName: row.actualRecipientCharacterName,
			})
		}
	}

	const requestCharacterIds = [...new Set((matchingRequestsResult.rows ?? []).map((row) => row.characterId))]
	const idsToResolve = [
		...new Set(
			[...rowsResult.rows.map((row) => row.recipientId), ...requestCharacterIds].filter(
				(id): id is string => Boolean(id)
			)
		),
	]
	const resolver = getStub<EsiTypeResolver>(args.env.ESI_TYPE_RESOLVER, 'global')
	const resolvedNames: Record<string, string> =
		idsToResolve.length > 0 ? await resolver.resolveIds(idsToResolve).catch(() => ({})) : {}

	const computedItems = rowsResult.rows.map((row) => {
		const requestIdFromReason = (() => {
			const reasonText = row.reason ?? ''
			const match = reasonText.match(SRP_REQUEST_ID_IN_REASON_REGEX)
			return match?.[1] ?? null
		})()
		const expectedRequestCharacterId = requestIdFromReason
			? (requestById.get(requestIdFromReason) ?? null)
			: null
		const hasRecipientMismatch = Boolean(
			expectedRequestCharacterId && row.recipientId && row.recipientId !== expectedRequestCharacterId
		)
		const hasMissingReasonWarning = Boolean(
			row.refType === 'corporation_account_withdrawal' &&
				row.recipientId &&
				(!row.reason || row.reason.trim().length === 0)
		)

		return {
			hasRecipientMismatch,
			hasMissingReasonWarning,
			linkedRequestId: (() => {
				if (!requestIdFromReason) return null
				return requestById.has(requestIdFromReason) ? requestIdFromReason : null
			})(),
			journalId: row.journalId,
			refType: row.refType,
			amount: row.amount,
			reason: row.reason,
			recipientId: row.recipientId,
			recipientName: row.recipientId ? (resolvedNames[row.recipientId] ?? null) : null,
			entryDate: serializeWalletHistoryEntryDate(row.entryDate),
			matchingAlertKinds: alertKindsByJournalId.get(row.journalId) ?? [],
			alertDetail:
				paymentAlertDetailByJournalId.get(row.journalId) ??
				(hasRecipientMismatch
					? {
							expectedAmount: null,
							observedAmount: row.amount,
							expectedRecipientCharacterId: expectedRequestCharacterId,
							expectedRecipientCharacterName: expectedRequestCharacterId
								? (resolvedNames[expectedRequestCharacterId] ?? null)
								: null,
							actualRecipientCharacterId: row.recipientId,
							actualRecipientCharacterName: row.recipientId
								? (resolvedNames[row.recipientId] ?? null)
								: null,
					  }
					: null),
			hasOpenAlert:
				(alertKindsByJournalId.get(row.journalId) ?? []).length > 0 ||
				hasRecipientMismatch,
		}
	})

	const filteredItems = args.filters.alertsOnly
		? computedItems.filter((item) => item.hasOpenAlert || item.hasMissingReasonWarning)
		: computedItems

	try {
		await writer.writeLine(
			buildCsvLine([
				'entryDate',
				'reason',
				'recipientId',
				'recipientName',
				'amount',
				'journalId',
				'refType',
				'hasOpenAlert',
				'hasMissingReasonWarning',
				'linkedRequestId',
				'alertKinds',
				'alertDetail',
			])
		)

		for (const item of filteredItems) {
			await writer.writeLine(
				buildCsvLine([
					item.entryDate,
					item.reason,
					item.recipientId,
					item.recipientName,
					item.amount,
					item.journalId,
					item.refType,
					item.hasOpenAlert,
					item.hasMissingReasonWarning,
					item.linkedRequestId,
					(item.matchingAlertKinds ?? []).join('|'),
					item.alertDetail ? JSON.stringify(item.alertDetail) : '',
				])
			)
			rowCount += 1
		}

		await writer.close()
		return rowCount
	} catch (error) {
		await writer.abort().catch(() => {})
		throw error
	}
}

/**
 * Start a paid SRP requests export workflow.
 * POST /api/srp/requests/paid/export?characterName=&shipTypeName=&solarSystemName=&dateFrom=&dateTo=
 */
srp.post('/requests/paid/export', async (c) => {
	const user = c.get('user')!
	const canReview = await hasSrpTierPermission(c.env, user.id, 'reviewer', user.is_admin)
	if (!canReview) return c.json({ error: 'Requires SRP staff permissions' }, 403)

	const characterName = c.req.query('characterName')?.trim() || undefined
	const shipTypeName = c.req.query('shipTypeName')?.trim() || undefined
	const solarSystemName = c.req.query('solarSystemName')?.trim() || undefined
	const dateFrom = c.req.query('dateFrom')?.trim() || undefined
	const dateTo = c.req.query('dateTo')?.trim() || undefined
	const dateRange = parseSrpCsvExportDateRange(dateFrom, dateTo)
	if ('error' in dateRange) {
		return c.json({ error: dateRange.error }, 400)
	}

	const workflow = await createWorkflow(c.env.EXPORT_WORKFLOW, {
		params: {
			kind: 'srp-paid-requests',
			userId: user.id,
			characterName,
			shipTypeName,
			solarSystemName,
			dateFrom: dateRange.dateFrom,
			dateTo: dateRange.dateTo,
		},
	})

	return c.json(
		{
			workflowInstanceId: workflow.id,
			exportId: workflow.id,
			fileName: buildSrpPaidRequestsExportFileName(dateRange.dateFrom, dateRange.dateTo),
			status: 'queued',
		},
		202
	)
})

srp.get('/requests/paid/export/:workflowInstanceId', async (c) => {
	const user = c.get('user')!
	const canReview = await hasSrpTierPermission(c.env, user.id, 'reviewer', user.is_admin)
	if (!canReview) return c.json({ error: 'Requires SRP staff permissions' }, 403)

	const workflowInstanceId = c.req.param('workflowInstanceId')
	if (!workflowInstanceId) {
		return c.json({ error: 'workflowInstanceId is required' }, 400)
	}

	const workflow = await c.env.EXPORT_WORKFLOW.get(workflowInstanceId)
	const status = await workflow.status()
	const outputStatus =
		status.output && typeof status.output === 'object' && 'status' in status.output
			? String((status.output as { status?: string }).status ?? '')
			: undefined
	return c.json({
		workflowInstanceId,
		status: normalizeWorkflowStatus(status.status, outputStatus),
		rawStatus: status.status,
		output: status.output ?? null,
	})
})

srp.get('/requests/paid/export/:workflowInstanceId/download', async (c) => {
	const user = c.get('user')!
	const canReview = await hasSrpTierPermission(c.env, user.id, 'reviewer', user.is_admin)
	if (!canReview) return c.json({ error: 'Requires SRP staff permissions' }, 403)

	const workflowInstanceId = c.req.param('workflowInstanceId')
	if (!workflowInstanceId) {
		return c.json({ error: 'workflowInstanceId is required' }, 400)
	}

	const bucket = getSrpExportBucket(c.env)
	const exportKey = buildSrpPaidRequestsExportKey(workflowInstanceId)
	const object = await bucket.get(exportKey)
	if (!object) {
		return c.json({ error: 'Export not found' }, 404)
	}
	if (isExportArtifactExpired(object.customMetadata?.expiresAt)) {
		await bucket.delete(exportKey).catch(() => {})
		return c.json({ error: 'Export expired' }, 404)
	}

	const fileName = object.customMetadata?.fileName ?? `${workflowInstanceId}.csv`
	const response = new Response(object.body, {
		status: 200,
		headers: {
			'Content-Type': object.httpMetadata?.contentType ?? 'text/csv; charset=utf-8',
			'Content-Disposition': `attachment; filename="${fileName}"`,
			'Cache-Control': 'no-store',
		},
	})
	const executionCtx = getExecutionContextOrNull(c)
	const cleanup = bucket.delete(exportKey).catch(() => {})
	if (executionCtx) {
		executionCtx.waitUntil(cleanup)
	} else {
		void cleanup
	}
	return response
})

/**
 * Wallet history for configured SRP payment processor corporation
 * GET /api/srp/payments/wallet-history?reason=&recipientId=&alertsOnly=false&dateFrom=&dateTo=&limit=50&offset=0
 *
 * Requires payer-or-higher permissions
 */
srp.get('/payments/wallet-history', async (c) => {
	const user = c.get('user')!
	const canPay = await hasSrpTierPermission(c.env, user.id, 'payer', user.is_admin)
	if (!canPay) return c.json({ error: 'Requires payer-or-higher permissions' }, 403)

	const reason = c.req.query('reason')?.trim()
	const recipientId = c.req.query('recipientId')?.trim()
	const alertsOnly = c.req.query('alertsOnly') === 'true'
	const dateFrom = c.req.query('dateFrom')?.trim()
	const dateTo = c.req.query('dateTo')?.trim()
	const limit = c.req.query('limit') ? Number.parseInt(c.req.query('limit')!, 10) : 50
	const offset = c.req.query('offset') ? Number.parseInt(c.req.query('offset')!, 10) : 0

	if (!Number.isFinite(limit) || limit < 1 || limit > 200) {
		return c.json({ error: 'limit must be between 1 and 200' }, 400)
	}
	if (!Number.isFinite(offset) || offset < 0) {
		return c.json({ error: 'offset must be >= 0' }, 400)
	}

	const srpStub = getStub<Srp>(c.env.SRP, 'default')
	const config = await srpStub.getConfig()
	const processorCorporationId = config?.paymentProcessorCorporationId?.trim() ?? ''
	if (!processorCorporationId) {
		return c.json({ error: 'SRP payment processor corporation is not configured' }, 400)
	}

	const db = c.get('db')
	if (!db) return c.json({ error: 'Database unavailable' }, 500)
	const whereClause = buildSrpWalletHistoryWhereClause({
		processorCorporationId,
		reason: reason ?? undefined,
		recipientId: recipientId ?? undefined,
		dateFrom: dateFrom ?? undefined,
		dateTo: dateTo ?? undefined,
	})

	const [rowsResult, countResult] = await Promise.all([
		db.execute<WalletHistoryRow>(
			buildSrpWalletHistoryRowsQuery({
				processorCorporationId,
				whereClause,
				alertsOnly,
				limit,
				offset,
			})
		),
		db.execute<{ total: number }>(
			buildSrpWalletHistoryCountQuery({
				processorCorporationId,
				whereClause,
				alertsOnly,
			})
		),
	])

	const rows = rowsResult.rows ?? []
	const total = countResult.rows?.[0]?.total ?? 0
	const journalIds = [...new Set(rows.map((row) => row.journalId))]
	const alertKindsByJournalId = new Map<string, string[]>()
	const paymentAlertDetailByJournalId = new Map<
		string,
		{
			expectedAmount: string | null
			observedAmount: string | null
			expectedRecipientCharacterId: string | null
			expectedRecipientCharacterName: string | null
			actualRecipientCharacterId: string | null
			actualRecipientCharacterName: string | null
		}
	>()
	for (const row of
		(
			await (journalIds.length > 0
				? db.execute<{
						journalId: string
						kind: string
						state: string
						expectedAmount: string | null
						observedAmount: string | null
						expectedRecipientCharacterId: string | null
						expectedRecipientCharacterName: string | null
						actualRecipientCharacterId: string | null
						actualRecipientCharacterName: string | null
					}>(
						sql`select
								journal_id::text as "journalId",
								kind,
								state,
								expected_amount as "expectedAmount",
								observed_amount as "observedAmount",
								expected_recipient_character_id as "expectedRecipientCharacterId",
								expected_recipient_character_name as "expectedRecipientCharacterName",
								actual_recipient_character_id as "actualRecipientCharacterId",
								actual_recipient_character_name as "actualRecipientCharacterName"
							from srp_payment_alerts
							where journal_id in ${sql`(${sql.join(journalIds.map((id) => sql`${id}`), sql`,`)})`}`
					)
				: Promise.resolve({
						rows: [] as Array<{
							journalId: string
							kind: string
							state: string
							expectedAmount: string | null
							observedAmount: string | null
							expectedRecipientCharacterId: string | null
							expectedRecipientCharacterName: string | null
							actualRecipientCharacterId: string | null
							actualRecipientCharacterName: string | null
						}>,
					})
		)).rows ?? []) {
		const existing = alertKindsByJournalId.get(row.journalId) ?? []
		if (row.state === 'open' && !existing.includes(row.kind)) {
			existing.push(row.kind)
			alertKindsByJournalId.set(row.journalId, existing)
		}
		if (row.state === 'open' && !paymentAlertDetailByJournalId.has(row.journalId)) {
			paymentAlertDetailByJournalId.set(row.journalId, {
				expectedAmount: row.expectedAmount,
				observedAmount: row.observedAmount,
				expectedRecipientCharacterId: row.expectedRecipientCharacterId,
				expectedRecipientCharacterName: row.expectedRecipientCharacterName,
				actualRecipientCharacterId: row.actualRecipientCharacterId,
				actualRecipientCharacterName: row.actualRecipientCharacterName,
			})
		}
	}

	const idsToResolve = [
		...new Set(
			[
				...rows.map((row) => row.recipientId),
				...rows.map((row) => row.expectedRequestCharacterId),
			].filter(
				(id): id is string => Boolean(id)
			)
		),
	]
	const resolver = getStub<EsiTypeResolver>(c.env.ESI_TYPE_RESOLVER, 'global')
	const resolvedNames: Record<string, string> =
		idsToResolve.length > 0 ? await resolver.resolveIds(idsToResolve).catch(() => ({})) : {}

	const items = rows.map((row) => {
		const hasRecipientMismatch = Boolean(row.hasRecipientMismatch)
		const expectedRecipientCharacterName = row.expectedRequestCharacterId
			? (resolvedNames[row.expectedRequestCharacterId] ?? null)
			: null

		return {
			hasRecipientMismatch,
			hasMissingReasonWarning: row.hasMissingReasonWarning,
			linkedRequestId: row.linkedRequestId,
			journalId: row.journalId,
			refType: row.refType,
			amount: row.amount,
			reason: row.reason,
			recipientId: row.recipientId,
			recipientName: row.recipientId ? (resolvedNames[row.recipientId] ?? null) : null,
			entryDate: serializeWalletHistoryEntryDate(row.entryDate),
			matchingAlertKinds: alertKindsByJournalId.get(row.journalId) ?? [],
			alertDetail:
				paymentAlertDetailByJournalId.get(row.journalId) ??
				(hasRecipientMismatch
					? {
							expectedAmount: null,
							observedAmount: row.amount,
							expectedRecipientCharacterId: row.expectedRequestCharacterId,
							expectedRecipientCharacterName,
							actualRecipientCharacterId: row.recipientId,
							actualRecipientCharacterName: row.recipientId
								? (resolvedNames[row.recipientId] ?? null)
								: null,
					  }
					: null),
			hasOpenAlert: row.hasOpenAlert,
		}
	})

	return c.json({
		items,
		total,
		limit,
		offset,
	})
})

/**
 * Start an SRP wallet history export workflow.
 * POST /api/srp/payments/wallet-history/export?reason=&recipientId=&alertsOnly=false&dateFrom=&dateTo=
 */
srp.post('/payments/wallet-history/export', async (c) => {
	const user = c.get('user')!
	const canPay = await hasSrpTierPermission(c.env, user.id, 'payer', user.is_admin)
	if (!canPay) return c.json({ error: 'Requires payer-or-higher permissions' }, 403)

	const reason = c.req.query('reason')?.trim()
	const recipientId = c.req.query('recipientId')?.trim()
	const alertsOnly = c.req.query('alertsOnly') === 'true'
	const dateFrom = c.req.query('dateFrom')?.trim()
	const dateTo = c.req.query('dateTo')?.trim()
	const dateRange = parseSrpCsvExportDateRange(dateFrom, dateTo)
	if ('error' in dateRange) {
		return c.json({ error: dateRange.error }, 400)
	}

	const workflow = await createWorkflow(c.env.EXPORT_WORKFLOW, {
		params: {
			kind: 'srp-wallet-history',
			userId: user.id,
			reason,
			recipientId,
			alertsOnly,
			dateFrom: dateRange.dateFrom,
			dateTo: dateRange.dateTo,
		},
	})

	return c.json(
		{
			workflowInstanceId: workflow.id,
			exportId: workflow.id,
			fileName: buildSrpWalletHistoryExportFileName(dateRange.dateFrom, dateRange.dateTo),
			status: 'queued',
		},
		202
	)
})

srp.get('/payments/wallet-history/export/:workflowInstanceId', async (c) => {
	const user = c.get('user')!
	const canPay = await hasSrpTierPermission(c.env, user.id, 'payer', user.is_admin)
	if (!canPay) return c.json({ error: 'Requires payer-or-higher permissions' }, 403)

	const workflowInstanceId = c.req.param('workflowInstanceId')
	if (!workflowInstanceId) {
		return c.json({ error: 'workflowInstanceId is required' }, 400)
	}

	const workflow = await c.env.EXPORT_WORKFLOW.get(workflowInstanceId)
	const status = await workflow.status()
	const outputStatus =
		status.output && typeof status.output === 'object' && 'status' in status.output
			? String((status.output as { status?: string }).status ?? '')
			: undefined
	return c.json({
		workflowInstanceId,
		status: normalizeWorkflowStatus(status.status, outputStatus),
		rawStatus: status.status,
		output: status.output ?? null,
	})
})

srp.get('/payments/wallet-history/export/:workflowInstanceId/download', async (c) => {
	const user = c.get('user')!
	const canPay = await hasSrpTierPermission(c.env, user.id, 'payer', user.is_admin)
	if (!canPay) return c.json({ error: 'Requires payer-or-higher permissions' }, 403)

	const workflowInstanceId = c.req.param('workflowInstanceId')
	if (!workflowInstanceId) {
		return c.json({ error: 'workflowInstanceId is required' }, 400)
	}

	const bucket = getSrpExportBucket(c.env)
	const exportKey = buildSrpWalletHistoryExportKey(workflowInstanceId)
	const object = await bucket.get(exportKey)
	if (!object) {
		return c.json({ error: 'Export not found' }, 404)
	}
	if (isExportArtifactExpired(object.customMetadata?.expiresAt)) {
		await bucket.delete(exportKey).catch(() => {})
		return c.json({ error: 'Export expired' }, 404)
	}

	const fileName = object.customMetadata?.fileName ?? `${workflowInstanceId}.csv`
	const response = new Response(object.body, {
		status: 200,
		headers: {
			'Content-Type': object.httpMetadata?.contentType ?? 'text/csv; charset=utf-8',
			'Content-Disposition': `attachment; filename="${fileName}"`,
			'Cache-Control': 'no-store',
		},
	})
	const executionCtx = getExecutionContextOrNull(c)
	const cleanup = bucket.delete(exportKey).catch(() => {})
	if (executionCtx) {
		executionCtx.waitUntil(cleanup)
	} else {
		void cleanup
	}
	return response
})

/**
 * Search values for SRP wallet history filters
 * GET /api/srp/payments/wallet-history/search-values?field=recipient|reason&q=...
 *
 * Requires payer-or-higher permissions
 */
srp.get('/payments/wallet-history/search-values', async (c) => {
	const user = c.get('user')!
	const canPay = await hasSrpTierPermission(c.env, user.id, 'payer', user.is_admin)
	if (!canPay) return c.json({ error: 'Requires payer-or-higher permissions' }, 403)

	const parsedField = WalletHistorySearchFieldQuerySchema.safeParse(c.req.query('field'))
	if (!parsedField.success) return c.json({ error: 'Invalid search field' }, 400)
	const field = parsedField.data
	const q = c.req.query('q')?.trim() ?? ''
	if (q.length < 2) return c.json({ values: [] })

	const srpStub = getStub<Srp>(c.env.SRP, 'default')
	const config = await srpStub.getConfig()
	const processorCorporationId = config?.paymentProcessorCorporationId?.trim() ?? ''
	if (!processorCorporationId) {
		return c.json({ error: 'SRP payment processor corporation is not configured' }, 400)
	}

	const db = c.get('db')
	if (!db) return c.json({ error: 'Database unavailable' }, 500)

	if (field === 'reason') {
		const result = await db.execute<{ value: string }>(
			sql`select distinct reason as "value"
				from corporation_wallet_journal
				where corporation_id = ${processorCorporationId}
					and ref_type = 'corporation_account_withdrawal'
					and exists (
						select 1
						from user_characters recipient_char
						where recipient_char.character_id = second_party_id
					)
					and reason is not null
					and reason ilike ${`%${q}%`}
				order by "value" asc
				limit 25`
		)
		return c.json({
			values: (result.rows ?? [])
				.map((row) => row.value)
				.filter((value): value is string => typeof value === 'string' && value.length > 0)
				.map((value) => ({ value, label: value })),
		})
	}

	const result = await db.execute<{ value: string }>(
		sql`select distinct wallet_ids."value"
			from corporation_wallet_journal as wj
			cross join lateral (select wj.second_party_id::text as "value") as wallet_ids
			left join user_characters uc on uc.character_id = wallet_ids."value"
			where wj.corporation_id = ${processorCorporationId}
				and wj.ref_type = 'corporation_account_withdrawal'
				and exists (
					select 1
					from user_characters recipient_char
					where recipient_char.character_id = wj.second_party_id
				)
				and wallet_ids."value" is not null
				and (
					wallet_ids."value" ilike ${`%${q}%`}
					or uc.character_name ilike ${`%${q}%`}
				)
			order by wallet_ids."value" asc
			limit 25`
	)
	const values = (result.rows ?? [])
		.map((row) => row.value)
		.filter((value): value is string => typeof value === 'string' && value.length > 0)

	const resolver = getStub<EsiTypeResolver>(c.env.ESI_TYPE_RESOLVER, 'global')
	const resolvedNames: Record<string, string> =
		values.length > 0 ? await resolver.resolveIds(values).catch(() => ({})) : {}

	return c.json({
		values: values.map((value) => ({
			value,
			label: resolvedNames[value] ?? value,
			description: resolvedNames[value] ? value : undefined,
		})),
	})
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

	const srpStub = getStub<Srp>(c.env.SRP, 'default')
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

	const srpStub = getStub<Srp>(c.env.SRP, 'default')
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

	const srpStub = getStub<Srp>(c.env.SRP, 'default')
	const existingRequest = await srpStub.getRequest(requestId, user.id)
	if (!existingRequest) return c.json({ error: 'Request not found' }, 404)
	const request = await srpStub.markPaid(
		existingRequest.id,
		user.id,
		getPrimaryCharacterName(user)
	)

	return c.json(request)
})

/**
 * Manually verify a request as paid (manager/admin)
 * POST /api/srp/requests/:id/verify-paid
 */
srp.post('/requests/:id/verify-paid', async (c) => {
	const user = c.get('user')!
	const requestId = c.req.param('id')
	if (!isValidSrpRequestId(requestId)) {
		return c.json({ error: 'Invalid request id' }, 400)
	}

	const body = await c.req.json().catch(() => ({}))
	const validation = VerifyPaidManuallySchema.safeParse(body)
	if (!validation.success) {
		return c.json({ error: 'Invalid verification data', details: validation.error }, 400)
	}

	const canManage = await hasSrpTierPermission(c.env, user.id, 'manager', user.is_admin)
	if (!canManage) return c.json({ error: 'Requires manager-or-higher permissions' }, 403)

	const srpStub = getStub<Srp>(c.env.SRP, 'default')
	const existingRequest = await srpStub.getRequest(requestId, user.id)
	if (!existingRequest) return c.json({ error: 'Request not found' }, 404)
	if (existingRequest.requestStatus !== 'payment_pending') {
		return c.json({ error: 'Request must be in payment_pending to verify as paid' }, 409)
	}

	const request = await srpStub.updateReviewState(
		existingRequest.id,
		user.id,
		getPrimaryCharacterName(user),
		'paid',
		`Manually verified as paid by ${getPrimaryCharacterName(user)}`
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
	const srpStub = getStub<Srp>(c.env.SRP, 'default')
	const config = await srpStub.getConfig()

	if (!config) {
		return c.json({ error: 'No configuration found' }, 404)
	}

	return c.json(config)
})

/**
 * Get active Discord guilds available for SRP output configuration.
 * GET /api/srp/config/discord-guilds
 */
srp.get('/config/discord-guilds', async (c) => {
	const user = c.get('user')!
	const canManage = await hasSrpTierPermission(c.env, user.id, 'manager', user.is_admin)
	if (!canManage) return c.json({ error: 'Requires manager-or-higher permissions' }, 403)

	const db = createDb(c.env.DATABASE_URL)
	const rows = await db
		.select({ id: discordServers.id, guildId: discordServers.guildId, guildName: discordServers.guildName })
		.from(discordServers)
		.where(eq(discordServers.isActive, true))
		.orderBy(asc(discordServers.guildName))
	return c.json(rows)
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

	const srpStub = getStub<Srp>(c.env.SRP, 'default')
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

	const srpStub = getStub<Srp>(c.env.SRP, 'default')
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

	const srpStub = getStub<Srp>(c.env.SRP, 'default')
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

	const srpStub = getStub<Srp>(c.env.SRP, 'default')
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

	const srpStub = getStub<Srp>(c.env.SRP, 'default')
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
	const srpStub = getStub<Srp>(c.env.SRP, 'default')
	await srpStub.deletePolicy(id, user.id)
	return c.json({ ok: true })
})

export default srp
