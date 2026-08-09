import { DurableObject } from 'cloudflare:workers'

import {
	and,
	asc,
	desc,
	eq,
	gt,
	gte,
	inArray,
	isNotNull,
	like,
	lt,
	lte,
	ne,
	or,
	sql,
} from '@repo/db-utils'
import { getStub, withRpcResult } from '@repo/do-utils'
import { logger, TimeCache, toErrorLogDetails } from '@repo/hono-helpers'
import {
	getStructureTabForTypeId,
	SKYHOOK_MAGMATIC_GAS_TYPE_ID,
	SKYHOOK_MAGMATIC_GAS_TYPE_NAME,
	SKYHOOK_SUPERIONIC_ICE_TYPE_ID,
	SKYHOOK_SUPERIONIC_ICE_TYPE_NAME,
	summarizeSovereigntyReagentBay,
} from '@repo/structures'
import { normalizeUniverseServiceName } from '@repo/universe'
import { parseDateOrNull } from '@repo/worker-utils'
import { retryWithBackoff } from '@repo/workflow-utils'

import { createDb } from './db'
import {
	characterCorporationRoles,
	corporationAssets,
	corporationConfig,
	corporationContracts,
	corporationDirectors,
	corporationIndustryJobs,
	corporationKillmails,
	corporationMembers,
	corporationMemberTracking,
	corporationOrders,
	corporationPublicInfo,
	corporationStructureInventory,
	corporationStructureInventorySnapshots,
	corporationStructures,
	corporationWalletJournal,
	corporationWallets,
	corporationWalletTransactions,
	structureMiningExtractions,
	structureMoonDrills,
	structureMoonGeographies,
	structureSkyhookReagents,
	structureSkyhooks,
	structureSovereigntyHubs,
	structureSovereigntySystems,
} from './db/schema'
import { dedupeByItemId, syncAssetsPaged } from './services/assets-paging-sync'
import { DirectorManager } from './services/director-manager'
import * as esiFetch from './services/esi-fetch'
import { calculateStructureFuelBurnRateDetails } from './services/structure-fuel-calculation'
import {
	hasCompleteStructureStaticHydration,
	preserveStructureHydrationFields,
} from './services/structure-hydration'
import {
	findRefilledStructureIds,
	projectStructureInventoryFromStoredAssets,
	summarizeFuelBlockUnitsByStructure,
} from './services/structure-inventory'

import type { SQL } from 'drizzle-orm'
import type {
	CharacterCorporationRolesData,
	CorporationAccessVerification,
	CorporationAssetData,
	CorporationAssetsData,
	CorporationAuthStatus,
	CorporationConfigData,
	CorporationContractData,
	CorporationContractSortBy,
	CorporationContractsPageData,
	CorporationCoreData,
	CorporationFinancialData,
	CorporationIndustryJobData,
	CorporationKillmailData,
	CorporationMarketData,
	CorporationMemberData,
	CorporationMembersPageData,
	CorporationMemberTrackingData,
	CorporationOrderData,
	CorporationPublicData,
	CorporationRole,
	CorporationStructureData,
	CorporationStructureInventoryData,
	CorporationStructureQuery,
	CorporationSyncHealth,
	CorporationTaxMetadata,
	CorporationType,
	CorporationWalletData,
	CorporationWalletJournalData,
	CorporationWalletTransactionData,
	CourierLeaderboard,
	DirectorHealth,
	EsiCharacterRoles,
	EsiCorporationContract,
	EsiCorporationIndustryJob,
	EsiCorporationKillmail,
	EsiCorporationMembers,
	EsiCorporationMemberTracking,
	EsiCorporationMiningExtraction,
	EsiCorporationOrder,
	EsiCorporationSkyhook,
	EsiCorporationStructure,
	EsiCorporationWalletTransaction,
	EsiSovereigntyHub,
	EsiSovereigntySystem,
	EveCorporationData,
	MiningCitadelSyncPriority,
	MoonDrillSyncPriority,
	SearchAssetsFilters,
	SkyhookStoreResult,
	SkyhookSyncPriority,
	SovereigntyHubSyncPriority,
	StructureInventorySyncResult,
	StructureSyncFailureTarget,
	StructureSyncPriorityTarget,
	WalletJournalWindowFilters,
	WalletTransactionWatermark,
	WalletTransactionWindowFilters,
} from '@repo/eve-corporation-data'
import type { EsiResponse, EveTokenStore } from '@repo/eve-token-store'
import type { EveCharacterId, EveStructureId } from '@repo/eve-types'
import type { SovereigntyReagentEntry, StructureSovereigntyTransportState } from '@repo/structures'
import type {
	EsiGetStructureResponse,
	Universe,
	UniverseFuelModuleRule,
	UniversePlanetGeography,
	UniverseRegion,
	UniverseSolarSystem,
} from '@repo/universe'
import type { Env } from './context'
import type { RawEsiAsset } from './services/assets-paging-sync'
import type { StructureInventoryRowInput } from './services/structure-inventory'

function isSpecialStructureTab(tab: ReturnType<typeof getStructureTabForTypeId>): boolean {
	return tab === 'sovereignty' || tab === 'skyhooks'
}

function minutesAgo(minutes: number): Date {
	return new Date(Date.now() - minutes * 60 * 1000)
}

function normalizeSovereigntyWorkforceTransport(
	transport: EsiSovereigntyHub['workforce_transport']
): StructureSovereigntyTransportState {
	const normalizeImport = (section: { sources: Array<{ solar_system_id: number }> }) => ({
		mode: 'import' as const,
		systems: section.sources.map((source) => ({
			solarSystemId: String(source.solar_system_id),
			amount: null,
		})),
	})

	const normalizeExport = (section: { amount: number; solar_system_id?: number }) => ({
		mode: 'export' as const,
		systems: [
			{
				solarSystemId: String(section.solar_system_id ?? ''),
				amount: section.amount,
			},
		].filter((entry) => entry.solarSystemId.length > 0),
	})

	const normalizeTransit = () => ({ mode: 'transit' as const, systems: [] })

	const normalizeSection = (
		section: EsiSovereigntyHub['workforce_transport']['configuration']
	): StructureSovereigntyTransportState['configuration'] => {
		if ('import' in section) return normalizeImport(section.import)
		if ('export' in section) return normalizeExport(section.export)
		return normalizeTransit()
	}

	const normalizeStateSection = (
		section: EsiSovereigntyHub['workforce_transport']['state']
	): StructureSovereigntyTransportState['state'] => {
		if ('import' in section) {
			return {
				mode: 'import',
				systems: section.import.sources.map((source) => ({
					solarSystemId: String(source.solar_system_id),
					amount: source.amount,
				})),
			}
		}
		if ('export' in section) return normalizeExport(section.export)
		return normalizeTransit()
	}

	return {
		configuration: normalizeSection(transport.configuration),
		state: normalizeStateSection(transport.state),
	}
}

type SortDirection = 'asc' | 'desc'

const REQUIRED_CORPORATION_WALLET_SCOPE = 'esi-wallet.read_corporation_wallets.v1'
const CHARACTER_WALLET_SCOPE = 'esi-wallet.read_character_wallet.v1'
const CORPORATION_MEMBERSHIP_SCOPE = 'esi-corporations.read_corporation_membership.v1'
const NPC_CORPORATION_ID_MIN = 1_000_000
const NPC_CORPORATION_ID_MAX = 1_999_999
const SHARED_SOVEREIGNTY_SYSTEMS_CACHE_META_KEY = 'shared:sovereignty-systems:observed-at'
const SHARED_SOVEREIGNTY_SYSTEMS_CACHE_COUNT_KEY = 'shared:sovereignty-systems:count'
const SHARED_SOVEREIGNTY_SYSTEMS_CACHE_ROW_PREFIX = 'shared:sovereignty-systems:row:'
const SHARED_SOVEREIGNTY_SYSTEMS_CACHE_MAX_AGE_SECONDS = 60 * 60
const SHARED_SOVEREIGNTY_SYSTEMS_REFRESH_LEASE_KEY = 'shared:sovereignty-systems:refresh-lease'
const SHARED_SOVEREIGNTY_SYSTEMS_REFRESH_LEASE_SECONDS = 2 * 60
const ORBITAL_SKYHOOK_TYPE_ID = '81080'
const STRUCTURE_ENRICHMENT_PRIORITY_LIMIT = 100
const STRUCTURE_INVENTORY_ASSET_BATCH_SIZE = 250
const STRUCTURE_SNAPSHOT_BATCH_SIZE = 10
const STRUCTURE_CLEANUP_BATCH_SIZE = 250
const INVENTORY_SNAPSHOT_CLEANUP_BATCH_SIZE = 250
const INVENTORY_SNAPSHOT_CLEANUP_MAX_BATCHES = 4
const WALLET_JOURNAL_INSERT_BATCH_SIZE = 100
const WALLET_TRANSACTION_INSERT_BATCH_SIZE = 100
const STRUCTURE_FUEL_SYNC_FAILURE_REASON =
	'Some online service modules could not be identified for fuel consumption purposes'

function compareNumericStrings(left: string, right: string): number {
	try {
		const leftBigInt = BigInt(left)
		const rightBigInt = BigInt(right)
		if (leftBigInt === rightBigInt) {
			return 0
		}
		return leftBigInt > rightBigInt ? 1 : -1
	} catch {
		return left.localeCompare(right, 'en')
	}
}

interface NormalizedDecimal {
	sign: -1 | 0 | 1
	digits: string
	scale: number
}

function normalizeDecimal(value: unknown): NormalizedDecimal | null {
	const text = String(value ?? '').trim()
	const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))$/.exec(text)
	if (!match) {
		return null
	}

	const sign = match[1] === '-' ? -1 : 1
	const whole = match[2] ?? '0'
	let fraction = match[3] ?? match[4] ?? ''
	while (fraction.endsWith('0')) {
		fraction = fraction.slice(0, -1)
	}

	const digits = `${whole}${fraction}`.replace(/^0+(?=\d)/, '')
	if (/^0+$/.test(digits)) {
		return { sign: 0, digits: '0', scale: 0 }
	}

	return {
		sign,
		digits,
		scale: fraction.length,
	}
}

function areOppositeAmounts(left: unknown, right: unknown): boolean {
	const leftAmount = normalizeDecimal(left)
	const rightAmount = normalizeDecimal(right)
	if (leftAmount === null || rightAmount === null) {
		return false
	}

	return (
		leftAmount.sign !== 0 &&
		rightAmount.sign !== 0 &&
		leftAmount.sign === -rightAmount.sign &&
		leftAmount.digits === rightAmount.digits &&
		leftAmount.scale === rightAmount.scale
	)
}

function walletJournalMetadata(entry: any): string {
	return JSON.stringify([
		entry.context_id ?? null,
		entry.context_id_type ?? null,
		entry.date ?? null,
		entry.description ?? null,
		entry.first_party_id ?? null,
		entry.reason ?? null,
		entry.ref_type ?? null,
		entry.second_party_id ?? null,
		entry.tax ?? null,
		entry.tax_receiver_id ?? null,
	])
}

function filterZeroSumJournalPairs(entries: any[]): any[] {
	const entriesByJournalId = new Map<string, number[]>()
	for (const [index, entry] of entries.entries()) {
		const journalId = String(entry.id)
		const indexes = entriesByJournalId.get(journalId) ?? []
		indexes.push(index)
		entriesByJournalId.set(journalId, indexes)
	}

	const filteredIndexes = new Set<number>()
	for (const indexes of entriesByJournalId.values()) {
		for (let leftPosition = 0; leftPosition < indexes.length; leftPosition += 1) {
			const leftIndex = indexes[leftPosition]
			if (leftIndex === undefined || filteredIndexes.has(leftIndex)) {
				continue
			}

			const left = entries[leftIndex]
			for (
				let rightPosition = leftPosition + 1;
				rightPosition < indexes.length;
				rightPosition += 1
			) {
				const rightIndex = indexes[rightPosition]
				if (rightIndex === undefined || filteredIndexes.has(rightIndex)) {
					continue
				}

				const right = entries[rightIndex]
				if (
					walletJournalMetadata(left) === walletJournalMetadata(right) &&
					areOppositeAmounts(left.amount, right.amount)
				) {
					filteredIndexes.add(leftIndex)
					filteredIndexes.add(rightIndex)
					break
				}
			}
		}
	}

	return entries.filter((_, index) => !filteredIndexes.has(index))
}

function chunkArray<T>(items: readonly T[], size: number): T[][] {
	const chunks: T[][] = []
	for (let index = 0; index < items.length; index += size) {
		chunks.push(items.slice(index, index + size))
	}
	return chunks
}

async function deleteIdsInBatches(
	ids: readonly string[],
	batchSize: number,
	deleteBatch: (batch: string[]) => Promise<void>
): Promise<void> {
	for (const batch of chunkArray(ids, batchSize)) {
		await deleteBatch(batch)
	}
}

function parseNumberOrNull(value: unknown): number | null {
	if (value === null || value === undefined || value === '') {
		return null
	}
	if (typeof value === 'number') {
		return Number.isFinite(value) ? value : null
	}
	const parsed = Number.parseFloat(String(value))
	return Number.isFinite(parsed) ? parsed : null
}

async function resolveAllianceNames(
	tokenStore: EveTokenStore,
	allianceIds: readonly string[]
): Promise<Map<string, string | null>> {
	const uniqueAllianceIds = [...new Set(allianceIds.filter((value) => value.length > 0))]
	if (uniqueAllianceIds.length === 0) {
		return new Map()
	}

	const resolved = await Promise.all(
		uniqueAllianceIds.map(async (allianceId) => {
			try {
				const name = await withRpcResult(
					tokenStore.fetchPublicEsi<{ name?: string }>(`/alliances/${allianceId}`, {
						cacheMode: 'no-store',
					}),
					(response) => response.data.name?.trim() ?? null
				)
				return [allianceId, name] as const
			} catch (error) {
				logger.warn('[EveCorporationData] Failed to resolve alliance name', {
					allianceId,
					error: error instanceof Error ? error.message : String(error),
				})
				return [allianceId, null] as const
			}
		})
	)

	return new Map(resolved)
}

type SkyhookStateRow = typeof structureSkyhooks.$inferSelect
type SovereigntyHubInsertRow = typeof structureSovereigntyHubs.$inferInsert
type SkyhookInsertRow = typeof structureSkyhooks.$inferInsert
type SharedSovereigntySystemsRefreshLease = {
	token: string
	expiresAtMs: number
	acquiredAtMs: number
}
type SkyhookStorageRow = {
	structureId: string
	corporationId: string
	planetId: string
	planetName: string | null
	systemId: string
	systemName: string | null
	typeId: string
	state: string
	isActive: boolean
	effectiveWorkforce: number | null
	reinforcementTimerEnd: Date | null
	theftVulnerabilityStart: Date | null
	theftVulnerabilityEnd: Date | null
	syncStatus: 'ok' | 'warning' | 'error'
	syncFailureReason: string | null
	lastAttemptedSyncAt: Date
	lastObservedAt: Date
	sourceSyncAt: Date
	lastSyncedAt: Date
}

function cloneRpcRecord<T>(record: Record<string, T>): Record<string, T> {
	return Object.fromEntries(
		Object.entries(record).map(([key, value]) => [
			key,
			value !== null && typeof value === 'object' ? { ...value } : value,
		])
	) as Record<string, T>
}
type SkyhookReagentStorageRow = {
	structureId: string
	corporationId: string
	magmaticGasSecuredStock: number
	magmaticGasUnsecuredStock: number
	magmaticGasLastCycle: Date | null
	superionicIceSecuredStock: number
	superionicIceUnsecuredStock: number
	superionicIceLastCycle: Date | null
}
type SkyhookReagentStorageInsertRow = SkyhookReagentStorageRow & {
	updatedAt: Date
}
type SkyhookBaseStructureRow = {
	structureId: string
	corporationId: string
	name: string | null
	typeId: string
	typeName: string | null
	systemId: string
	systemName: string | null
	regionId: string | null
	regionName: string | null
	profileId: string
	fuelExpires: Date | null
	fuelAmount: number | null
	lastRefilledAt: Date | null
	nextReinforceApply: Date | null
	nextReinforceHour: number | null
	reinforceHour: number | null
	state: string
	stateTimerEnd: Date | null
	stateTimerStart: Date | null
	unanchorsAt: Date | null
	lowPower: boolean
	syncStatus: 'ok' | 'warning' | 'error'
	syncFailureReason: string | null
	lastSyncedAt: Date | null
	services: Array<{ name: string; state: string }> | null
	updatedAt: Date
}
const STRUCTURE_PRUNE_GRACE_MS = 72 * 60 * 60 * 1000

function normalizeSkyhookState(
	state: string,
	reinforcementTimerEnd: Date | null
): 'invulnerable' | 'vulnerable' | 'reinforced' {
	const normalized = state.trim().toLowerCase()
	if (reinforcementTimerEnd !== null || normalized.includes('reinforce')) {
		return 'reinforced'
	}
	return 'vulnerable'
}

function isBeyondStructurePruneGrace(updatedAt: Date | null | undefined, now: Date): boolean {
	if (!updatedAt) {
		return true
	}

	return now.getTime() - updatedAt.getTime() >= STRUCTURE_PRUNE_GRACE_MS
}

function filterPrunableStructureIds<T extends { structureId: string; updatedAt?: Date | null }>(
	rows: T[],
	currentStructureIds: Set<string>,
	now: Date
): string[] {
	return rows
		.filter((row) => !currentStructureIds.has(row.structureId))
		.filter((row) => isBeyondStructurePruneGrace(row.updatedAt, now))
		.map((row) => row.structureId)
}

type SkyhookPlanetGeography = Pick<
	UniversePlanetGeography,
	'planetId' | 'planetName' | 'solarSystemName'
> | null

type MoonGeographyStorageRow = {
	structureId: string
	corporationId: string
	moonId: string
	moonName: string | null
	planetId: string
	planetName: string | null
	systemId: string
	systemName: string | null
	sourceSyncAt: Date
	lastSyncedAt: Date
	updatedAt: Date
}

type MoonDrillStorageRow = {
	structureId: string
	corporationId: string
	sourceSyncAt: Date
	lastAttemptedSyncAt: Date
	lastSyncedAt: Date
	syncFailureReason: string | null
	updatedAt: Date
}

export function buildSkyhookStorageRow(input: {
	corporationId: string
	skyhook: EsiCorporationSkyhook
	baseStructure: Pick<
		SkyhookBaseStructureRow,
		'corporationId' | 'structureId' | 'typeId' | 'systemId' | 'systemName'
	>
	existingRow: Pick<SkyhookStateRow, 'planetName' | 'systemName'> | null
	planet: SkyhookPlanetGeography
	observedAt: Date
}): SkyhookStorageRow | null {
	const { corporationId, skyhook, baseStructure, existingRow, planet, observedAt } = input

	if (baseStructure.corporationId !== corporationId) {
		return null
	}

	const resolvedPlanetName = planet?.planetName ?? existingRow?.planetName ?? null
	const resolvedSystemName =
		planet?.solarSystemName ?? baseStructure.systemName ?? existingRow?.systemName ?? null

	return {
		structureId: skyhook.structure_id,
		corporationId,
		planetId: planet?.planetId ?? skyhook.planet_id,
		planetName: resolvedPlanetName,
		systemId: baseStructure.systemId,
		systemName: resolvedSystemName,
		typeId: baseStructure.typeId,
		state: normalizeSkyhookState(
			skyhook.state,
			parseDateOrNull(skyhook.reinforcement_timer?.end) ?? null
		),
		isActive: skyhook.is_active,
		effectiveWorkforce: skyhook.effective_workforce ?? null,
		reinforcementTimerEnd: parseDateOrNull(skyhook.reinforcement_timer?.end) ?? null,
		theftVulnerabilityStart: parseDateOrNull(skyhook.theft_vulnerability?.start) ?? null,
		theftVulnerabilityEnd: parseDateOrNull(skyhook.theft_vulnerability?.end) ?? null,
		syncStatus: 'ok',
		syncFailureReason: null,
		lastAttemptedSyncAt: observedAt,
		lastObservedAt: observedAt,
		sourceSyncAt: observedAt,
		lastSyncedAt: observedAt,
	} satisfies SkyhookStorageRow
}

function buildSkyhookReagentStorageRow(input: {
	corporationId: string
	skyhook: EsiCorporationSkyhook
	observedAt: Date
}): SkyhookReagentStorageInsertRow {
	const { corporationId, skyhook, observedAt } = input
	const magmaticGasReagent = skyhook.reagents.find(
		(reagent) => reagent.type_id === SKYHOOK_MAGMATIC_GAS_TYPE_ID
	)
	const superionicIceReagent = skyhook.reagents.find(
		(reagent) => reagent.type_id === SKYHOOK_SUPERIONIC_ICE_TYPE_ID
	)

	return {
		structureId: skyhook.structure_id,
		corporationId,
		magmaticGasSecuredStock: magmaticGasReagent?.secured_stock ?? 0,
		magmaticGasUnsecuredStock: magmaticGasReagent?.unsecured_stock ?? 0,
		magmaticGasLastCycle: parseDateOrNull(magmaticGasReagent?.last_cycle) ?? null,
		superionicIceSecuredStock: superionicIceReagent?.secured_stock ?? 0,
		superionicIceUnsecuredStock: superionicIceReagent?.unsecured_stock ?? 0,
		superionicIceLastCycle: parseDateOrNull(superionicIceReagent?.last_cycle) ?? null,
		updatedAt: observedAt,
	}
}

function buildMoonDrillStorageRow(input: {
	corporationId: string
	structure: Pick<{ structureId: string; corporationId: string }, 'structureId' | 'corporationId'>
	observedAt: Date
}): MoonDrillStorageRow | null {
	const { corporationId, structure, observedAt } = input

	if (structure.corporationId !== corporationId) {
		return null
	}

	return {
		structureId: structure.structureId,
		corporationId,
		sourceSyncAt: observedAt,
		lastAttemptedSyncAt: observedAt,
		lastSyncedAt: observedAt,
		syncFailureReason: null,
		updatedAt: observedAt,
	}
}

function buildMoonGeographyStorageRow(input: {
	corporationId: string
	structure: Pick<
		{
			structureId: string
			corporationId: string
			systemId: string
			systemName: string | null
			structureInfo: EsiGetStructureResponse | null
		},
		'structureId' | 'corporationId' | 'systemId' | 'systemName' | 'structureInfo'
	>
	moonGeography: Awaited<ReturnType<Universe['resolveNearestMoonGeographyBySystemPosition']>> | null
	observedAt: Date
}): MoonGeographyStorageRow | null {
	const { corporationId, structure, moonGeography, observedAt } = input

	if (structure.corporationId !== corporationId) {
		return null
	}

	if (!moonGeography) {
		return null
	}

	return {
		structureId: structure.structureId,
		corporationId,
		moonId: moonGeography.moonId,
		moonName: moonGeography.moonName ?? null,
		planetId: moonGeography.planetId,
		planetName: moonGeography.planetName ?? null,
		systemId: moonGeography.solarSystemId,
		systemName: moonGeography.solarSystemName ?? structure.systemName ?? null,
		sourceSyncAt: observedAt,
		lastSyncedAt: observedAt,
		updatedAt: observedAt,
	}
}

function addHours(date: Date, hours: number): Date {
	return new Date(date.getTime() + hours * 60 * 60 * 1000)
}

/**
 * EveCorporationData Durable Object
 *
 * Each corporation gets its own Durable Object instance for data isolation.
 * Uses PostgreSQL for persistent storage and eve-token-store for ESI access.
 *
 * Instance ID pattern: `{corporationId}`
 * Example: `98000001`
 */
export class EveCorporationDataDO extends DurableObject<Env> implements EveCorporationData {
	private readonly DIRECTORS_CACHE_TTL = 30 * 60 // 30 minutes in seconds (KV expirationTtl)
	private readonly courierLeaderboardCache = new TimeCache<CourierLeaderboard>(5 * 60 * 1000)

	private isNpcCorporationId(corporationId: string): boolean {
		const parsed = Number(corporationId)
		if (!Number.isFinite(parsed)) return false
		const id = Math.trunc(parsed)
		return id >= NPC_CORPORATION_ID_MIN && id <= NPC_CORPORATION_ID_MAX
	}

	private assertNonNpcCorporation(corporationId: string): void {
		if (!this.isNpcCorporationId(corporationId)) return
		throw new Error(`NPC corporation ${corporationId} is not supported by eve-corporation-data`)
	}

	private compareNullableString(left: string | null, right: string | null): number {
		if (left === right) return 0
		if (left === null || left === '') return 1
		if (right === null || right === '') return -1
		return left.localeCompare(right)
	}

	private compareNullableNumber(left: number | null, right: number | null): number {
		if (left === right) return 0
		if (left === null || left === undefined) return 1
		if (right === null || right === undefined) return -1
		return left - right
	}

	private compareNullableNumericString(left: string | null, right: string | null): number {
		if (left === right) return 0
		if (left === null || left === '') return 1
		if (right === null || right === '') return -1
		const leftValue = Number.parseFloat(left)
		const rightValue = Number.parseFloat(right)
		if (!Number.isFinite(leftValue) && !Number.isFinite(rightValue)) return 0
		if (!Number.isFinite(leftValue)) return 1
		if (!Number.isFinite(rightValue)) return -1
		return leftValue - rightValue
	}

	private compareAllianceCourierContracts(
		left: CorporationContractData,
		right: CorporationContractData,
		sortBy: CorporationContractSortBy,
		sortDirection: SortDirection
	) {
		let comparison = 0
		switch (sortBy) {
			case 'pickup': {
				comparison = this.compareNullableString(left.startLocationId, right.startLocationId)
				break
			}
			case 'dropoff': {
				comparison = this.compareNullableString(left.endLocationId, right.endLocationId)
				break
			}
			case 'volume': {
				comparison = this.compareNullableNumericString(left.volume, right.volume)
				break
			}
			case 'reward': {
				comparison = this.compareNullableNumericString(left.reward, right.reward)
				break
			}
			case 'collateral': {
				comparison = this.compareNullableNumericString(left.collateral, right.collateral)
				break
			}
			case 'daysToComplete': {
				comparison = this.compareNullableNumber(left.daysToComplete, right.daysToComplete)
				break
			}
			case 'expires':
			default:
				comparison = left.dateExpired.getTime() - right.dateExpired.getTime()
				break
		}

		if (comparison !== 0) {
			return sortDirection === 'asc' ? comparison : -comparison
		}

		const issuedComparison = right.dateIssued.getTime() - left.dateIssued.getTime()
		if (issuedComparison !== 0) return issuedComparison

		return right.contractId.localeCompare(left.contractId)
	}

	private mapAllianceCourierContract(
		row: typeof corporationContracts.$inferSelect
	): CorporationContractData {
		return {
			id: row.id,
			contractId: row.contractId,
			acceptorId: row.acceptorId,
			assigneeId: row.assigneeId,
			availability: row.availability,
			buyout: row.buyout,
			collateral: row.collateral,
			dateAccepted: row.dateAccepted,
			dateCompleted: row.dateCompleted,
			dateExpired: row.dateExpired,
			dateIssued: row.dateIssued,
			daysToComplete: row.daysToComplete,
			endLocationId: row.endLocationId,
			forCorporation: row.forCorporation,
			issuerCorporationId: row.issuerCorporationId,
			issuerId: row.issuerId,
			price: row.price,
			reward: row.reward,
			startLocationId: row.startLocationId,
			status: row.status,
			title: row.title,
			type: row.type,
			volume: row.volume,
			updatedAt: row.updatedAt,
		}
	}

	/**
	 * Initialize the Durable Object with database connection
	 */
	constructor(
		public state: DurableObjectState,
		public env: Env
	) {
		super(state, env)
	}

	// ========================================================================
	// HELPER METHODS
	// ========================================================================

	private getDb(): ReturnType<typeof createDb> {
		return createDb(this.env.DATABASE_URL)
	}
	/**
	 * Get a stub for the EveTokenStore Durable Object
	 */
	private getEveTokenStoreStub() {
		return getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
	}

	private createDirectorManager(corporationId: string): DirectorManager {
		const tokenStoreStub = this.getEveTokenStoreStub()
		return new DirectorManager(
			this.getDb(),
			corporationId,
			tokenStoreStub,
			this.onDirectorAffiliationMismatch.bind(this),
			undefined,
			async ({ corporationId: targetCorporationId, healthyDirectorCount, isVerified }) => {
				try {
					await this.env.CORE.updateCorporationAuthHealth(targetCorporationId, {
						healthyDirectorCount,
						isVerified,
					})
					await this.invalidateDirectorsCache(targetCorporationId)
				} catch (error) {
					logger.warn('[EveCorporationData] Failed to propagate corporation auth health snapshot', {
						corporationId: targetCorporationId,
						error: error instanceof Error ? error.message : String(error),
					})
				}
			}
		)
	}

	private async onDirectorAffiliationMismatch(
		characterId: string,
		expectedCorporationId: string,
		actualCorporationId: string | null
	): Promise<void> {
		try {
			await this.clearCharacterRolesSnapshot(characterId)
		} catch (error) {
			logger.warn(
				'[EveCorporationData] Failed to clear stale director role cache after affiliation mismatch',
				{
					characterId,
					expectedCorporationId,
					actualCorporationId,
					error: error instanceof Error ? error.message : String(error),
				}
			)
		}

		try {
			await withRpcResult(
				this.env.CORE.handleCharacterAffiliationChanges([characterId], {
					source: `director-affiliation-mismatch:${expectedCorporationId}:${actualCorporationId ?? 'unknown'}`,
					bypassThrottle: true,
				}),
				() => undefined
			)
		} catch (error) {
			logger.warn('[EveCorporationData] Failed to propagate director affiliation mismatch', {
				characterId,
				expectedCorporationId,
				actualCorporationId,
				error: error instanceof Error ? error.message : String(error),
			})
		}
	}

	/**
	 * Invalidate directors cache for a corporation
	 */
	private async invalidateDirectorsCache(corporationId: string): Promise<void> {
		const cacheKey = `directors:${corporationId}`
		try {
			await this.env.CACHE.delete(cacheKey)
		} catch (error) {
			logger.warn('[Directors Cache] Failed to invalidate cache', { corporationId, error })
		}
	}

	/**
	 * Invalidate members cache for a corporation
	 */
	private async invalidateMembersCache(corporationId: string): Promise<void> {
		const cacheKey = `members:${corporationId}`
		try {
			await this.env.CACHE.delete(cacheKey)
		} catch (error) {
			logger.warn('[Members Cache] Failed to invalidate cache', { corporationId, error })
		}
	}

	/**
	 * Get the configured character ID for this corporation
	 * @deprecated Use DirectorManager.selectDirector() instead for multi-director support
	 * @throws Error if corporation not configured
	 */
	private async getConfiguredCharacter(
		corporationId: string
	): Promise<{ characterId: string; corporationId: string }> {
		// Try to get a healthy director first
		const config = await this.getDb().query.corporationConfig.findFirst({
			where: eq(corporationConfig.corporationId, corporationId),
		})

		if (!config) {
			throw new Error('Corporation not configured.')
		}

		const directorManager = this.createDirectorManager(config.corporationId)

		const director = await directorManager.selectDirector()

		if (!director) {
			throw new Error('No healthy directors available. Please add or verify directors.')
		}

		return {
			characterId: director.characterId,
			corporationId: config.corporationId,
		}
	}

	/**
	 * Get DirectorManager instance for this corporation
	 */
	private async getDirectorManager(): Promise<DirectorManager> {
		const config = await this.getDb().query.corporationConfig.findFirst()

		if (!config) {
			throw new Error('Corporation not configured.')
		}

		return this.createDirectorManager(config.corporationId)
	}

	/**
	 * Check if character has a required role
	 */
	private async storeCharacterRolesSnapshot(
		corporationId: string,
		characterId: string,
		roles: EsiCharacterRoles
	): Promise<void> {
		await this.getDb()
			.insert(characterCorporationRoles)
			.values({
				corporationId,
				characterId,
				roles: roles.roles || [],
				rolesAtHq: roles.roles_at_hq,
				rolesAtBase: roles.roles_at_base,
				rolesAtOther: roles.roles_at_other,
				updatedAt: new Date(),
			})
			.onConflictDoUpdate({
				target: [characterCorporationRoles.corporationId, characterCorporationRoles.characterId],
				set: {
					roles: roles.roles || [],
					rolesAtHq: roles.roles_at_hq,
					rolesAtBase: roles.roles_at_base,
					rolesAtOther: roles.roles_at_other,
					updatedAt: new Date(),
				},
			})
	}

	private async hasRequiredCorpRole(
		corporationId: string,
		characterId: string,
		requiredRole: CorporationRole
	): Promise<boolean> {
		logger.info('[EveCorporationData] hasRequiredCorpRole: Checking corp role', {
			corporationId,
			characterId,
			requiredRole,
		})

		const getRolesSnapshot = async (): Promise<EsiCharacterRoles | null> => {
			const rolesData = await this.getDb().query.characterCorporationRoles.findFirst({
				where: and(
					eq(characterCorporationRoles.corporationId, corporationId),
					eq(characterCorporationRoles.characterId, characterId)
				),
			})

			if (!rolesData) {
				return null
			}

			return {
				roles: rolesData.roles || undefined,
				roles_at_hq: rolesData.rolesAtHq || undefined,
				roles_at_base: rolesData.rolesAtBase || undefined,
				roles_at_other: rolesData.rolesAtOther || undefined,
			}
		}

		const hasRole = (rolesData: EsiCharacterRoles | null): boolean => {
			if (!rolesData) {
				return false
			}
			const allRoles = [
				...(rolesData.roles || []),
				...(rolesData.roles_at_hq || []),
				...(rolesData.roles_at_base || []),
				...(rolesData.roles_at_other || []),
			]
			return allRoles.includes(requiredRole)
		}

		const cachedRoles = await getRolesSnapshot()
		if (hasRole(cachedRoles)) {
			return true
		}

		try {
			return await withRpcResult(
				retryWithBackoff<EsiResponse<EsiCharacterRoles>>(
					() =>
						this.getEveTokenStoreStub().fetchEsi(`/characters/${characterId}/roles`, characterId, {
							cacheMode: 'no-store',
						}),
					{
						onRetry: (attempt, error, delayMs) => {
							logger.warn('[EveCorporationData] Retrying role refresh after ESI throttling', {
								corporationId,
								characterId,
								requiredRole,
								attempt,
								delayMs,
								error: error.message,
							})
						},
					}
				),
				async (response) => {
					await this.storeCharacterRolesSnapshot(corporationId, characterId, response.data)
					return hasRole(response.data)
				}
			)
		} catch (error) {
			logger.warn('[EveCorporationData] Failed to refresh roles while checking corp role', {
				corporationId,
				characterId,
				requiredRole,
				error: error instanceof Error ? error.message : String(error),
			})
			return false
		}
	}

	/**
	 * Require character to have one of the given corporation roles.
	 */
	private async requireCorpRole(
		corporationId: string,
		characterId: string,
		roles: CorporationRole[]
	): Promise<void> {
		for (const role of roles) {
			if (await this.hasRequiredCorpRole(corporationId, characterId, role)) {
				return // Has at least one required role
			}
		}

		throw new Error(`Character lacks required role(s): ${roles.join(', ')}`)
	}

	// ========================================================================
	// CONFIGURATION METHODS
	// ========================================================================

	async getCorporationsNeedingRefresh(): Promise<string[]> {
		const tooOld = minutesAgo(20)
		const assetsTooOld = minutesAgo(60)
		const structuresTooOld = minutesAgo(60)

		const configs = await this.getDb().query.corporationConfig.findMany({
			where: and(eq(corporationConfig.includeInBackgroundRefresh, true)),
		})

		const syncTargets = [
			{ field: 'membersLastSync' as const, cutoff: tooOld },
			{ field: 'memberTrackingLastSync' as const, cutoff: tooOld },
			{ field: 'walletsLastSync' as const, cutoff: tooOld },
			{ field: 'walletJournalLastSync' as const, cutoff: tooOld },
			{ field: 'walletTransactionsLastSync' as const, cutoff: tooOld },
			{ field: 'assetsLastSync' as const, cutoff: assetsTooOld },
			{ field: 'structuresLastSync' as const, cutoff: structuresTooOld },
			{ field: 'ordersLastSync' as const, cutoff: tooOld },
			{ field: 'contractsLastSync' as const, cutoff: tooOld },
			{ field: 'industryJobsLastSync' as const, cutoff: tooOld },
			{ field: 'killmailsLastSync' as const, cutoff: tooOld },
		]

		const isStale = (lastSync: Date | null | undefined, cutoff: Date) =>
			!lastSync || lastSync < cutoff

		// Collect unique corporation IDs that need refresh (any data type)
		const corporationIds = new Set<string>()

		for (const corp of configs) {
			// Check if any data type needs refresh
			for (const { field, cutoff } of syncTargets) {
				if (isStale(corp[field], cutoff)) {
					corporationIds.add(corp.corporationId)
					break // No need to check other fields for this corporation
				}
			}
		}

		const result = Array.from(corporationIds)

		logger.info('[EveCorporationData] getCorporationsNeedingRefresh: Results', {
			count: result.length,
			corporationIds: result,
		})

		return result
	}

	/**
	 * Get the lightweight corporation sync configuration for workflow gating
	 */
	async getCorporationSyncConfig(corporationId: string): Promise<{
		includeInBackgroundRefresh: boolean
		includeInStructureAssetSync: boolean
		assetsLastSync: Date | null
		structuresLastSync: Date | null
	} | null> {
		const config = await this.getDb().query.corporationConfig.findFirst({
			where: eq(corporationConfig.corporationId, corporationId),
			columns: {
				includeInBackgroundRefresh: true,
				includeInStructureAssetSync: true,
				assetsLastSync: true,
				structuresLastSync: true,
			},
		})

		if (!config) {
			return null
		}

		return {
			includeInBackgroundRefresh: config.includeInBackgroundRefresh,
			includeInStructureAssetSync: config.includeInStructureAssetSync,
			assetsLastSync: config.assetsLastSync,
			structuresLastSync: config.structuresLastSync,
		}
	}

	/**
	 * Update corporation configuration settings
	 */
	async updateCorporationConfig(
		corporationId: string,
		updates: { includeInBackgroundRefresh?: boolean; includeInStructureAssetSync?: boolean }
	): Promise<void> {
		this.assertNonNpcCorporation(corporationId)

		// Ensure corporation config exists
		const config = await this.getDb().query.corporationConfig.findFirst({
			where: eq(corporationConfig.corporationId, corporationId),
		})

		if (!config) {
			// Create config if it doesn't exist
			await this.getDb()
				.insert(corporationConfig)
				.values({
					corporationId: String(corporationId),
					isVerified: false,
					lastVerified: null,
					includeInBackgroundRefresh: updates.includeInBackgroundRefresh ?? false,
					includeInStructureAssetSync: updates.includeInStructureAssetSync ?? false,
					updatedAt: new Date(),
				})
		} else {
			// Update existing config
			await this.getDb()
				.update(corporationConfig)
				.set({
					...(updates.includeInBackgroundRefresh !== undefined && {
						includeInBackgroundRefresh: updates.includeInBackgroundRefresh,
					}),
					...(updates.includeInStructureAssetSync !== undefined && {
						includeInStructureAssetSync: updates.includeInStructureAssetSync,
					}),
					updatedAt: new Date(),
				})
				.where(eq(corporationConfig.corporationId, corporationId))
		}

		logger.info('[EveCorporationData] Updated corporation config', {
			corporationId,
			updates,
		})
	}

	/**
	 * Update corporation sync timestamp for a specific property
	 * Updates the corporationConfig table with the current timestamp for the specified sync property
	 */
	async updateCorporationSyncTimestamp(corporationId: string, syncProperty: string): Promise<void> {
		logger.debug('[EveCorporationData] Updating sync timestamp', {
			corporationId,
			syncProperty,
		})

		try {
			const timestamp = new Date()

			await this.getDb()
				.update(corporationConfig)
				.set({
					[syncProperty]: timestamp,
				})
				.where(eq(corporationConfig.corporationId, corporationId))

			logger.debug('[EveCorporationData] Sync timestamp updated successfully', {
				corporationId,
				syncProperty,
				timestamp: timestamp.toISOString(),
			})
		} catch (error) {
			logger.error('[EveCorporationData] Failed to update sync timestamp', {
				corporationId,
				syncProperty,
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
			})
			throw error
		}
	}

	/**
	 * Batch update corporation sync timestamps for multiple properties
	 * Updates the corporationConfig table with the current timestamp for all specified sync properties
	 * @param corporationId - The corporation ID
	 * @param syncProperties - Array of sync property names to update (e.g., ['membersLastSync', 'assetsLastSync'])
	 */
	async batchUpdateCorporationSyncTimestamps(
		corporationId: string,
		syncProperties: string[]
	): Promise<void> {
		if (syncProperties.length === 0) {
			return
		}

		logger.debug('[EveCorporationData] Batch updating sync timestamps', {
			corporationId,
			syncProperties,
			count: syncProperties.length,
		})

		try {
			const timestamp = new Date()

			// Build update object with all sync properties
			const updateData: Record<string, Date> = {}
			for (const syncProperty of syncProperties) {
				updateData[syncProperty] = timestamp
			}

			await this.getDb()
				.update(corporationConfig)
				.set(updateData)
				.where(eq(corporationConfig.corporationId, corporationId))

			logger.debug('[EveCorporationData] Batch sync timestamps updated successfully', {
				corporationId,
				syncProperties,
				count: syncProperties.length,
				timestamp: timestamp.toISOString(),
			})
		} catch (error) {
			logger.error('[EveCorporationData] Failed to batch update sync timestamps', {
				corporationId,
				syncProperties,
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
			})
			throw error
		}
	}

	/**
	 * Configure which character to use for API access (legacy method for backwards compatibility)
	 * @deprecated Use addDirector() instead
	 */
	async setCharacter(
		corporationId: string,
		characterId: string,
		characterName: string
	): Promise<void> {
		this.assertNonNpcCorporation(corporationId)

		// Ensure corporation config exists
		const config = await this.getDb().query.corporationConfig.findFirst({
			where: eq(corporationConfig.corporationId, corporationId),
		})

		if (!config) {
			await this.getDb()
				.insert(corporationConfig)
				.values({
					corporationId: String(corporationId),
					isVerified: false,
					lastVerified: null,
					updatedAt: new Date(),
				})
		}

		const directorManager = this.createDirectorManager(corporationId)

		// Check if director already exists
		const directors = await directorManager.getAllDirectors()
		const existingDirector = directors.find((d) => d.characterId === characterId)

		if (!existingDirector) {
			await directorManager.addDirector(characterId, characterName, 100)

			const inserted = (await directorManager.getAllDirectors()).find(
				(d) => d.characterId === characterId
			)
			if (inserted) {
				await directorManager.verifyDirectorHealth(inserted.directorId)
			}
		}
	}

	private async clearCharacterRolesSnapshot(characterId: string): Promise<void> {
		await this.getDb()
			.delete(characterCorporationRoles)
			.where(eq(characterCorporationRoles.characterId, characterId))
	}

	/**
	 * Get the configured character for this corporation
	 * @deprecated Use getDirectors() instead for multi-director support
	 */
	async getConfiguration(): Promise<CorporationConfigData | null> {
		const config = await this.getDb().query.corporationConfig.findFirst()

		if (!config) {
			return null
		}

		const directorManager = this.createDirectorManager(config.corporationId)
		const directors = await directorManager.getAllDirectors()
		const primaryDirector = directors[0] // First director by priority

		return {
			corporationId: config.corporationId,
			characterId: primaryDirector?.characterId || '',
			characterName: primaryDirector?.characterName || '',
			lastVerified: config.lastVerified,
			isVerified: config.isVerified,
			createdAt: config.createdAt,
			updatedAt: config.updatedAt,
			includeInBackgroundRefresh: config.includeInBackgroundRefresh,
			includeInStructureAssetSync: config.includeInStructureAssetSync,
			corporationType: config.corporationType as CorporationType,
			membersLastSync: config.membersLastSync,
			memberTrackingLastSync: config.memberTrackingLastSync,
			walletsLastSync: config.walletsLastSync,
			walletJournalLastSync: config.walletJournalLastSync,
			walletTransactionsLastSync: config.walletTransactionsLastSync,
			assetsLastSync: config.assetsLastSync,
			structuresLastSync: config.structuresLastSync,
			ordersLastSync: config.ordersLastSync,
			contractsLastSync: config.contractsLastSync,
			industryJobsLastSync: config.industryJobsLastSync,
			killmailsLastSync: config.killmailsLastSync,
		}
	}

	/**
	 * Verify that the configured character has access to corporation data
	 * @deprecated Use verifyAllDirectorsHealth() instead for multi-director support
	 */
	async verifyAccess(corporationId: string): Promise<CorporationAccessVerification> {
		logger.info('[EveCorporationData] verifyAccess started', { corporationId })
		const config = await this.getDb().query.corporationConfig.findFirst({
			where: eq(corporationConfig.corporationId, corporationId),
		})
		const fallbackMissingRoles = [
			'Required corporation sync roles were not satisfied by any healthy director',
		]

		const extractMissingRoles = (failureReasons: Array<string | null | undefined>): string[] => {
			const missingRoles = new Set<string>()

			for (const reason of failureReasons) {
				if (!reason) continue

				const match = reason.match(/Director missing required roles(?: for selection)?:\s*(.+)$/)
				if (!match) continue

				const roleGroups = [...match[1].matchAll(/\[([^\]]+)\]/g)].map((group) => group[1])
				for (const group of roleGroups) {
					const label = group
						.split('|')
						.map((role) => role.trim())
						.filter(Boolean)
						.join(' or ')
					if (label) {
						missingRoles.add(label)
					}
				}
			}

			return [...missingRoles]
		}

		if (!config) {
			logger.warn('[EveCorporationData] verifyAccess failed: no corporation config', {
				corporationId,
			})
			return {
				hasAccess: false,
				characterId: null,
				characterName: null,
				verifiedRoles: [],
				missingRoles: fallbackMissingRoles,
				lastVerified: null,
			}
		}

		const directorManager = this.createDirectorManager(corporationId)
		const result = await directorManager.verifyAllDirectorsHealth()
		const unhealthyDirectors = await directorManager.getUnhealthyDirectors()
		const missingRolesFromFailures = extractMissingRoles(
			unhealthyDirectors.map((director) => director.lastFailureReason)
		)
		const missingRoles =
			missingRolesFromFailures.length > 0 ? missingRolesFromFailures : fallbackMissingRoles

		// Get the first healthy director for backwards compatibility
		const healthyDirectors = await directorManager.getHealthyDirectors()
		const primaryDirector = healthyDirectors[0]

		if (!primaryDirector) {
			return {
				hasAccess: false,
				characterId: null,
				characterName: null,
				verifiedRoles: [],
				missingRoles,
				lastVerified: config.lastVerified,
			}
		}

		// Get roles for the primary director in the current corporation context
		const rolesData = await this.getDb().query.characterCorporationRoles.findFirst({
			where: and(
				eq(characterCorporationRoles.corporationId, corporationId),
				eq(characterCorporationRoles.characterId, primaryDirector.characterId)
			),
		})

		const verifiedRoles = rolesData
			? [
					...(rolesData.roles || []),
					...(rolesData.rolesAtHq || []),
					...(rolesData.rolesAtBase || []),
					...(rolesData.rolesAtOther || []),
				]
			: []

		const verification = {
			hasAccess: result.verified > 0,
			characterId: primaryDirector.characterId,
			characterName: primaryDirector.characterName,
			verifiedRoles,
			missingRoles: result.verified > 0 ? undefined : missingRoles,
			lastVerified: config.lastVerified,
		}

		if (verification.hasAccess) {
			logger.info('[EveCorporationData] verifyAccess completed', {
				corporationId,
				hasAccess: true,
				verifiedCount: result.verified,
				failedCount: result.failed,
				characterId: verification.characterId,
				characterName: verification.characterName,
			})
		} else {
			logger.warn('[EveCorporationData] verifyAccess completed without access', {
				corporationId,
				hasAccess: false,
				verifiedCount: result.verified,
				failedCount: result.failed,
				missingRoles: verification.missingRoles,
			})
		}

		return verification
	}

	// ========================================================================
	// DIRECTOR MANAGEMENT METHODS
	// ========================================================================

	/**
	 * Get a load-balanced director character ID for this corporation
	 * @param corporationId - The corporation ID
	 * @returns A load-balanced director character ID or null if no healthy directors are available
	 */
	async getLoadBalancedDirector(corporationId: string): Promise<string | null> {
		const directorManager = this.createDirectorManager(corporationId)
		const selected = await directorManager.selectDirector()
		logger.info('[EveCorporationData] getLoadBalancedDirector: Selected director', {
			corporationId,
			selected,
		})
		if (!selected) {
			logger.error('[EveCorporationData] getLoadBalancedDirector: No director selected', {
				corporationId,
			})
			return null
		}
		return String(selected.characterId)
	}

	/**
	 * Add a new director character for this corporation
	 */
	async addDirector(
		corporationId: string,
		characterId: string,
		characterName: string,
		priority = 100
	): Promise<void> {
		this.assertNonNpcCorporation(corporationId)

		const config = await this.getDb().query.corporationConfig.findFirst({
			where: eq(corporationConfig.corporationId, corporationId),
		})

		if (!config) {
			// Create config if it doesn't exist
			await this.getDb()
				.insert(corporationConfig)
				.values({
					corporationId: String(corporationId),
					isVerified: false,
					lastVerified: null,
					updatedAt: new Date(),
				})
		}

		const directorManager = this.createDirectorManager(corporationId)
		await directorManager.addDirector(characterId, characterName, priority)

		const inserted = (await directorManager.getAllDirectors()).find(
			(d) => d.characterId === characterId
		)
		if (inserted) {
			await directorManager.verifyDirectorHealth(inserted.directorId)
		}

		// Invalidate directors cache
		await this.invalidateDirectorsCache(corporationId)
	}

	/**
	 * Remove a director character from this corporation
	 */
	async removeDirector(corporationId: string, characterId: string): Promise<void> {
		this.assertNonNpcCorporation(corporationId)

		const directorManager = this.createDirectorManager(corporationId)
		await directorManager.removeDirector(characterId)

		// Invalidate directors cache
		await this.invalidateDirectorsCache(corporationId)
	}

	/**
	 * Update a director's priority
	 */
	async updateDirectorPriority(
		corporationId: string,
		characterId: string,
		priority: number
	): Promise<void> {
		this.assertNonNpcCorporation(corporationId)

		const directorManager = this.createDirectorManager(corporationId)
		await directorManager.updateDirectorPriority(characterId, priority)

		// Invalidate directors cache
		await this.invalidateDirectorsCache(corporationId)
	}

	/**
	 * Get all directors for this corporation
	 * Cached in KV for 30 minutes to reduce database queries
	 */
	async getDirectors(corporationId: string): Promise<DirectorHealth[]> {
		const cacheKey = `directors:${corporationId}`

		// Check KV cache first
		try {
			const cached = await this.env.CACHE.get<DirectorHealth[]>(cacheKey, 'json')
			if (cached) {
				// Convert Date fields from strings back to Date objects
				return cached.map((d) => ({
					...d,
					lastHealthCheck: d.lastHealthCheck ? new Date(d.lastHealthCheck) : null,
					lastUsed: d.lastUsed ? new Date(d.lastUsed) : null,
				}))
			}
		} catch (error) {
			// Cache read failure - log but continue to fetch from DB
			logger.warn('[Directors Cache] Failed to read from KV', { corporationId, error })
		}

		const directorManager = this.createDirectorManager(corporationId)
		const directors = await directorManager.getAllDirectors()

		// Store in KV cache with 30 minute TTL
		try {
			await this.env.CACHE.put(cacheKey, JSON.stringify(directors), {
				expirationTtl: this.DIRECTORS_CACHE_TTL,
			})
		} catch (error) {
			// Cache write failure - log but don't fail the request
			logger.warn('[Directors Cache] Failed to write to KV', { corporationId, error })
		}

		return directors
	}

	/**
	 * Get healthy directors for this corporation
	 */
	async getHealthyDirectors(corporationId: string): Promise<DirectorHealth[]> {
		const directorManager = this.createDirectorManager(corporationId)
		return await directorManager.getHealthyDirectors()
	}

	/**
	 * Get the number of healthy directors without loading director rows.
	 */
	async getHealthyDirectorCount(corporationId: string): Promise<number> {
		const directorManager = this.createDirectorManager(corporationId)
		return await directorManager.getHealthyDirectorsCount()
	}

	/**
	 * Verify health of a specific director
	 */
	async verifyDirectorHealth(corporationId: string, directorId: string): Promise<boolean> {
		const directorManager = this.createDirectorManager(corporationId)
		const result = await directorManager.verifyDirectorHealth(directorId)

		// Invalidate cache so next fetch returns fresh data
		await this.invalidateDirectorsCache(corporationId)

		return result
	}

	/**
	 * Verify health of all directors
	 */
	async verifyAllDirectorsHealth(
		corporationId: string,
		options?: { includePermanent?: boolean; bypassPermanentFailures?: boolean }
	): Promise<{ verified: number; failed: number }> {
		const directorManager = this.createDirectorManager(corporationId)
		const result = await directorManager.verifyAllDirectorsHealth(options)

		// Invalidate cache so next fetch returns fresh data
		await this.invalidateDirectorsCache(corporationId)

		return result
	}

	// ========================================================================
	// STORAGE-ONLY METHODS (public) - For use by workflows
	// ========================================================================

	/**
	 * Store public corporation info (workflow-friendly)
	 * Takes pre-fetched data and stores it in the database
	 */
	async storePublicInfo(corporationId: string, publicInfo: any): Promise<void> {
		await this.upsertPublicInfo(corporationId, publicInfo as CorporationPublicData)
	}

	/**
	 * Store corporation members (workflow-friendly)
	 * Handles member additions, updates, and departures.
	 * Automatically removes members from the database if they are no longer in the corporation.
	 * Returns IDs of departed members for HR processing.
	 */
	async storeMembers(
		corporationId: string,
		memberIds: string[]
	): Promise<{ departedMemberIds: string[]; addedMemberIds: string[] }> {
		// Fetch existing members to identify departures
		const existingMembers = await this.getDb()
			.select({ characterId: corporationMembers.characterId })
			.from(corporationMembers)
			.where(eq(corporationMembers.corporationId, corporationId))

		const existingMemberIds = new Set(existingMembers.map((m) => m.characterId))
		const currentMemberIds = new Set(memberIds)

		// Identify departed members
		const departedMemberIds = existingMembers
			.filter((m) => !currentMemberIds.has(m.characterId))
			.map((m) => m.characterId)

		try {
			// Remove departed members (those in database but not in current ESI response)
			if (departedMemberIds.length > 0) {
				await this.getDb()
					.delete(corporationMembers)
					.where(
						and(
							eq(corporationMembers.corporationId, corporationId),
							inArray(corporationMembers.characterId, departedMemberIds)
						)
					)

				// Also remove from tracking table
				await this.getDb()
					.delete(corporationMemberTracking)
					.where(
						and(
							eq(corporationMemberTracking.corporationId, corporationId),
							inArray(corporationMemberTracking.characterId, departedMemberIds)
						)
					)

				logger.info('[storeMembers] Removed departed members:', {
					corporationId,
					count: departedMemberIds.length,
					characterIds: departedMemberIds,
				})
			}

			// Upsert current members
			if (memberIds.length > 0) {
				const values = memberIds.map((memberId) => ({
					corporationId: String(corporationId),
					characterId: memberId,
				}))

				await this.getDb()
					.insert(corporationMembers)
					.values(values)
					.onConflictDoUpdate({
						target: [corporationMembers.corporationId, corporationMembers.characterId],
						set: {
							updatedAt: sql`CURRENT_TIMESTAMP`,
						},
					})
			}

			// Invalidate cache
			await this.invalidateMembersCache(corporationId)

			// Identify added members
			const addedMemberIds = memberIds.filter((id) => !existingMemberIds.has(id))
			if (addedMemberIds.length > 0 || departedMemberIds.length > 0) {
				logger.debug('[storeMembers] Member sync completed:', {
					corporationId,
					added: addedMemberIds.length,
					removed: departedMemberIds.length,
					total: memberIds.length,
				})
			}

			return { departedMemberIds, addedMemberIds }
		} catch (error) {
			logger.error('[storeMembers] Database operation failed:', {
				error,
				corporationId,
				memberCount: memberIds.length,
			})
			throw error
		}
	}

	/**
	 * Reconcile a single character's corporation membership rows using
	 * authoritative affiliation data from character sync.
	 */
	async reconcileCharacterCorporationMembership(
		characterId: string,
		corporationId: string | null
	): Promise<{
		removedFromCorporationIds: string[]
		addedToCorporationId: string | null
	}> {
		const normalizedCharacterId = String(characterId)
		const authoritativeCorporationId = corporationId ? String(corporationId) : null

		const existingRows = await this.getDb().query.corporationMembers.findMany({
			where: eq(corporationMembers.characterId, normalizedCharacterId),
			columns: {
				corporationId: true,
				characterId: true,
			},
		})

		const existingCorporationIds = new Set(existingRows.map((row) => row.corporationId))
		const removedFromCorporationIds = Array.from(existingCorporationIds).filter(
			(existingCorporationId) => existingCorporationId !== authoritativeCorporationId
		)

		if (removedFromCorporationIds.length > 0) {
			await this.getDb()
				.delete(corporationMembers)
				.where(
					and(
						eq(corporationMembers.characterId, normalizedCharacterId),
						inArray(corporationMembers.corporationId, removedFromCorporationIds)
					)
				)

			await this.getDb()
				.delete(corporationMemberTracking)
				.where(
					and(
						eq(corporationMemberTracking.characterId, normalizedCharacterId),
						inArray(corporationMemberTracking.corporationId, removedFromCorporationIds)
					)
				)

			await this.getDb()
				.delete(corporationDirectors)
				.where(
					and(
						eq(corporationDirectors.characterId, normalizedCharacterId),
						inArray(corporationDirectors.corporationId, removedFromCorporationIds)
					)
				)

			for (const removedCorporationId of removedFromCorporationIds) {
				await this.invalidateMembersCache(removedCorporationId)
				await this.invalidateDirectorsCache(removedCorporationId)
			}

			const departedMessages = removedFromCorporationIds.map((removedCorporationId) => ({
				body: {
					corporationId: removedCorporationId,
					characterId: normalizedCharacterId,
				},
			}))

			if (departedMessages.length > 0) {
				await this.env['hr-member-departed'].sendBatch(departedMessages)
			}
		}

		let addedToCorporationId: string | null = null
		if (authoritativeCorporationId && !existingCorporationIds.has(authoritativeCorporationId)) {
			const corporationExists = await this.getDb().query.corporationConfig.findFirst({
				where: eq(corporationConfig.corporationId, authoritativeCorporationId),
				columns: {
					corporationId: true,
				},
			})

			if (corporationExists) {
				await this.getDb()
					.insert(corporationMembers)
					.values({
						corporationId: authoritativeCorporationId,
						characterId: normalizedCharacterId,
					})
					.onConflictDoUpdate({
						target: [corporationMembers.corporationId, corporationMembers.characterId],
						set: {
							updatedAt: sql`CURRENT_TIMESTAMP`,
						},
					})

				await this.invalidateMembersCache(authoritativeCorporationId)
				addedToCorporationId = authoritativeCorporationId
			}
		}

		return {
			removedFromCorporationIds,
			addedToCorporationId,
		}
	}

	/**
	 * Store member tracking data (workflow-friendly)
	 */
	async storeMemberTracking(
		corporationId: string,
		trackingData: Array<{
			character_id: string
			base_id?: string
			location_id?: string
			logoff_date?: string
			logon_date?: string
			ship_type_id?: string
			start_date?: string
		}>
	): Promise<void> {
		// Identify departed members
		const existingTracking = await this.getDb()
			.select({ characterId: corporationMemberTracking.characterId })
			.from(corporationMemberTracking)
			.where(eq(corporationMemberTracking.corporationId, corporationId))

		const currentTrackingIds = new Set(trackingData.map((m) => m.character_id))
		const departedMemberIds = existingTracking
			.filter((m) => !currentTrackingIds.has(m.characterId))
			.map((m) => m.characterId)

		// Remove departed members
		if (departedMemberIds.length > 0) {
			await this.getDb()
				.delete(corporationMemberTracking)
				.where(
					and(
						eq(corporationMemberTracking.corporationId, corporationId),
						inArray(corporationMemberTracking.characterId, departedMemberIds)
					)
				)
		}

		// Upsert tracking data in batch
		if (trackingData.length > 0) {
			const values = trackingData.map((member) => ({
				corporationId: String(corporationId),
				characterId: member.character_id,
				baseId: member.base_id || null,
				locationId: member.location_id || null,
				logoffDate: member.logoff_date ? new Date(member.logoff_date) : null,
				logonDate: member.logon_date ? new Date(member.logon_date) : null,
				shipTypeId: member.ship_type_id || null,
				startDate: member.start_date ? new Date(member.start_date) : null,
				updatedAt: new Date(),
			}))

			await this.getDb()
				.insert(corporationMemberTracking)
				.values(values)
				.onConflictDoUpdate({
					target: [corporationMemberTracking.corporationId, corporationMemberTracking.characterId],
					set: {
						baseId: sql`excluded.base_id`,
						locationId: sql`excluded.location_id`,
						logoffDate: sql`excluded.logoff_date`,
						logonDate: sql`excluded.logon_date`,
						shipTypeId: sql`excluded.ship_type_id`,
						startDate: sql`excluded.start_date`,
						updatedAt: sql`excluded.updated_at`,
					},
				})
		}
	}

	/**
	 * Store wallets data (workflow-friendly)
	 */
	async storeWallets(
		corporationId: string,
		wallets: Array<{ division: number; balance: string }>
	): Promise<void> {
		if (wallets.length > 0) {
			const values = wallets.map((wallet) => ({
				corporationId: String(corporationId),
				division: wallet.division,
				balance: wallet.balance,
				updatedAt: new Date(),
			}))

			await this.getDb()
				.insert(corporationWallets)
				.values(values)
				.onConflictDoUpdate({
					target: [corporationWallets.corporationId, corporationWallets.division],
					set: {
						balance: sql`excluded.balance`,
						updatedAt: sql`excluded.updated_at`,
					},
				})
		}
	}

	/**
	 * Store wallet journal entries (workflow-friendly)
	 */
	async storeWalletJournal(
		corporationId: string,
		division: number,
		entries: any[]
	): Promise<{ persistedNewRows: number }> {
		if (entries.length === 0) {
			return { persistedNewRows: 0 }
		}

		const db = this.getDb()
		const [watermark] = await db
			.select({
				maxJournalId: sql<string | null>`max(${corporationWalletJournal.journalId}::numeric)::text`,
				maxJournalDate: sql<Date | string | null>`max(${corporationWalletJournal.date})`,
			})
			.from(corporationWalletJournal)
			.where(
				and(
					eq(corporationWalletJournal.corporationId, String(corporationId)),
					eq(corporationWalletJournal.division, division)
				)
			)
		const storedMaxJournalId = watermark?.maxJournalId ?? null
		const storedMaxJournalDate = parseDateOrNull(watermark?.maxJournalDate)
		const fetchedMaxJournalId = entries.reduce<string | null>((max, entry) => {
			const journalId = String(entry.id)
			if (max === null || compareNumericStrings(journalId, max) > 0) {
				return journalId
			}
			return max
		}, null)
		const fetchedMaxJournalDate = entries.reduce<Date | null>((max, entry) => {
			const entryDate = parseDateOrNull(entry.date)
			if (entryDate === null || max === null) {
				return entryDate ?? max
			}
			return entryDate > max ? entryDate : max
		}, null)

		if (
			storedMaxJournalId !== null &&
			fetchedMaxJournalId !== null &&
			compareNumericStrings(fetchedMaxJournalId, storedMaxJournalId) < 0 &&
			storedMaxJournalDate !== null &&
			(fetchedMaxJournalDate === null || fetchedMaxJournalDate < storedMaxJournalDate)
		) {
			logger.warn('[WalletJournalStore] ESI response is behind the stored journal watermark', {
				corporationId,
				division,
				storedMaxJournalId,
				fetchedMaxJournalId,
			})
		}

		// Sort chronologically before inserting so a partial failure advances the
		// date watermark as little as possible while still accepting late IDs.
		const candidateEntries = entries.filter((entry) => {
			if (storedMaxJournalId === null) {
				return true
			}

			if (compareNumericStrings(String(entry.id), storedMaxJournalId) > 0) {
				return true
			}

			const entryDate = parseDateOrNull(entry.date)
			return (
				storedMaxJournalDate !== null && entryDate !== null && entryDate >= storedMaxJournalDate
			)
		})
		const newEntries = filterZeroSumJournalPairs(candidateEntries)

		if (newEntries.length !== candidateEntries.length) {
			logger.info('[WalletJournalStore] Filtered zero-sum journal pairs', {
				corporationId,
				division,
				filteredEntries: candidateEntries.length - newEntries.length,
			})
		}

		const sortedEntries = newEntries.slice().sort((left, right) => {
			const leftDate = parseDateOrNull(left.date)
			const rightDate = parseDateOrNull(right.date)
			if (leftDate !== null && rightDate !== null && leftDate.getTime() !== rightDate.getTime()) {
				return leftDate < rightDate ? -1 : 1
			}
			return compareNumericStrings(String(left.id), String(right.id))
		})
		let persistedNewRows = 0
		for (let i = 0; i < sortedEntries.length; i += WALLET_JOURNAL_INSERT_BATCH_SIZE) {
			const batch = sortedEntries.slice(i, i + WALLET_JOURNAL_INSERT_BATCH_SIZE)
			const valuesToInsert = batch.map((entry) => ({
				corporationId: String(corporationId),
				division,
				journalId: String(entry.id),
				amount: entry.amount !== undefined ? String(entry.amount) : null,
				balance: entry.balance !== undefined ? String(entry.balance) : null,
				contextId: entry.context_id ? String(entry.context_id) : null,
				contextIdType: entry.context_id_type || null,
				date: new Date(entry.date),
				description: entry.description,
				firstPartyId: entry.first_party_id ? String(entry.first_party_id) : null,
				reason: entry.reason || null,
				refType: entry.ref_type,
				secondPartyId: entry.second_party_id ? String(entry.second_party_id) : null,
				tax: entry.tax !== undefined ? String(entry.tax) : null,
				taxReceiverId: entry.tax_receiver_id ? String(entry.tax_receiver_id) : null,
				updatedAt: new Date(),
			}))

			const insertedRows = await db
				.insert(corporationWalletJournal)
				.values(valuesToInsert)
				.onConflictDoNothing({
					target: [
						corporationWalletJournal.corporationId,
						corporationWalletJournal.division,
						corporationWalletJournal.journalId,
					],
				})
				.returning({ journalId: corporationWalletJournal.journalId })
			persistedNewRows += insertedRows.length
		}

		return { persistedNewRows }
	}

	/**
	 * Store wallet transactions (workflow-friendly)
	 */
	async storeWalletTransactions(
		corporationId: string,
		division: number,
		transactions: any[],
		providedWatermark?: WalletTransactionWatermark
	): Promise<{ persistedNewRows: number }> {
		if (transactions.length === 0) {
			return { persistedNewRows: 0 }
		}

		const db = this.getDb()
		let watermark = providedWatermark
		if (!watermark) {
			const [storedWatermark] = await db
				.select({
					maxTransactionId: sql<
						string | null
					>`max(${corporationWalletTransactions.transactionId}::numeric)::text`,
					maxTransactionDate: sql<Date | string | null>`max(${corporationWalletTransactions.date})`,
				})
				.from(corporationWalletTransactions)
				.where(
					and(
						eq(corporationWalletTransactions.corporationId, String(corporationId)),
						eq(corporationWalletTransactions.division, division)
					)
				)
			watermark = {
				maxTransactionId: storedWatermark?.maxTransactionId ?? null,
				maxTransactionDate: parseDateOrNull(storedWatermark?.maxTransactionDate),
			}
		}
		const storedMaxTransactionId = watermark.maxTransactionId
		const storedMaxTransactionDate = watermark.maxTransactionDate

		const dedupedTransactions = [
			...new Map(
				transactions.map((transaction) => [String(transaction.transaction_id), transaction])
			).values(),
		]
		const fetchedMaxTransactionId = dedupedTransactions.reduce<string | null>(
			(max, transaction) => {
				const transactionId = String(transaction.transaction_id)
				if (max === null || compareNumericStrings(transactionId, max) > 0) {
					return transactionId
				}
				return max
			},
			null
		)
		const fetchedMaxTransactionDate = dedupedTransactions.reduce<Date | null>(
			(max, transaction) => {
				const transactionDate = parseDateOrNull(transaction.date)
				if (transactionDate === null || max === null) {
					return transactionDate ?? max
				}
				return transactionDate > max ? transactionDate : max
			},
			null
		)

		if (
			storedMaxTransactionId !== null &&
			fetchedMaxTransactionId !== null &&
			compareNumericStrings(fetchedMaxTransactionId, storedMaxTransactionId) < 0 &&
			storedMaxTransactionDate !== null &&
			(fetchedMaxTransactionDate === null || fetchedMaxTransactionDate < storedMaxTransactionDate)
		) {
			logger.warn(
				'[WalletTransactionStore] ESI response is behind the stored transaction watermark',
				{
					corporationId,
					division,
					storedMaxTransactionId,
					fetchedMaxTransactionId,
				}
			)
		}

		const newTransactions = dedupedTransactions
			.filter((transaction) => {
				if (storedMaxTransactionId === null) {
					return true
				}

				if (compareNumericStrings(String(transaction.transaction_id), storedMaxTransactionId) > 0) {
					return true
				}

				const transactionDate = parseDateOrNull(transaction.date)
				return (
					storedMaxTransactionDate !== null &&
					transactionDate !== null &&
					transactionDate >= storedMaxTransactionDate
				)
			})
			.sort((left, right) => {
				const leftDate = parseDateOrNull(left.date)
				const rightDate = parseDateOrNull(right.date)
				if (leftDate !== null && rightDate !== null && leftDate.getTime() !== rightDate.getTime()) {
					return leftDate < rightDate ? -1 : 1
				}
				return compareNumericStrings(String(left.transaction_id), String(right.transaction_id))
			})

		let persistedNewRows = 0
		for (let i = 0; i < newTransactions.length; i += WALLET_TRANSACTION_INSERT_BATCH_SIZE) {
			const batch = newTransactions.slice(i, i + WALLET_TRANSACTION_INSERT_BATCH_SIZE)
			const valuesToInsert = batch.map((tx) => ({
				corporationId: String(corporationId),
				division,
				transactionId: String(tx.transaction_id),
				clientId: String(tx.client_id),
				date: new Date(tx.date),
				isBuy: tx.is_buy,
				isPersonal: tx.is_personal,
				journalRefId: String(tx.journal_ref_id),
				locationId: String(tx.location_id),
				quantity: tx.quantity,
				typeId: String(tx.type_id),
				unitPrice: String(tx.unit_price),
				updatedAt: new Date(),
			}))

			const insertedRows = await db
				.insert(corporationWalletTransactions)
				.values(valuesToInsert)
				.onConflictDoNothing({
					target: [
						corporationWalletTransactions.corporationId,
						corporationWalletTransactions.division,
						corporationWalletTransactions.transactionId,
					],
				})
				.returning({ transactionId: corporationWalletTransactions.transactionId })
			persistedNewRows += insertedRows.length
		}

		return { persistedNewRows }
	}

	async getWalletTransactionWatermarks(
		corporationId: string
	): Promise<Array<{ division: number; watermark: WalletTransactionWatermark }>> {
		const rows = await this.getDb()
			.select({
				division: corporationWalletTransactions.division,
				maxTransactionId: sql<
					string | null
				>`max(${corporationWalletTransactions.transactionId}::numeric)::text`,
				maxTransactionDate: sql<Date | string | null>`max(${corporationWalletTransactions.date})`,
			})
			.from(corporationWalletTransactions)
			.where(eq(corporationWalletTransactions.corporationId, String(corporationId)))
			.groupBy(corporationWalletTransactions.division)

		return rows.map((row) => ({
			division: row.division,
			watermark: {
				maxTransactionId: row.maxTransactionId,
				maxTransactionDate: parseDateOrNull(row.maxTransactionDate),
			},
		}))
	}

	/**
	 * Store assets (workflow-friendly)
	 */
	async storeAssets(corporationId: string, assets: any[]): Promise<void> {
		await this.storeAssetsPage(corporationId, assets, new Date())
	}

	private async storeAssetsPage(
		corporationId: string,
		assets: any[],
		observedAt: Date
	): Promise<void> {
		const dedupedAssets = dedupeByItemId(assets, (asset) => String(asset.item_id))
		const BATCH_SIZE = 25
		for (let i = 0; i < dedupedAssets.length; i += BATCH_SIZE) {
			const batch = dedupedAssets.slice(i, i + BATCH_SIZE)
			const valuesToInsert = batch.map((asset) => ({
				corporationId: String(corporationId),
				itemId: asset.item_id,
				isSingleton: asset.is_singleton,
				locationFlag: asset.location_flag,
				locationId: asset.location_id,
				locationType: asset.location_type,
				quantity: asset.quantity,
				typeId: asset.type_id,
				isBlueprintCopy: asset.is_blueprint_copy,
				updatedAt: observedAt,
			}))

			await this.getDb()
				.insert(corporationAssets)
				.values(valuesToInsert)
				.onConflictDoUpdate({
					target: [corporationAssets.corporationId, corporationAssets.itemId],
					set: {
						isSingleton: sql`excluded.is_singleton`,
						locationFlag: sql`excluded.location_flag`,
						locationId: sql`excluded.location_id`,
						locationType: sql`excluded.location_type`,
						quantity: sql`excluded.quantity`,
						typeId: sql`excluded.type_id`,
						isBlueprintCopy: sql`excluded.is_blueprint_copy`,
						updatedAt: sql`excluded.updated_at`,
					},
				})
		}
	}

	private async getOwnedStructureIds(corporationId: string): Promise<Set<string>> {
		const rows = await this.getDb().query.corporationStructures.findMany({
			where: eq(corporationStructures.corporationId, corporationId),
			columns: {
				structureId: true,
			},
		})

		return new Set(rows.map((row) => row.structureId))
	}

	private async getActiveStructureInventorySnapshotId(
		corporationId: string
	): Promise<string | null> {
		const snapshot = await this.getDb().query.corporationStructureInventorySnapshots.findFirst({
			where: and(
				eq(corporationStructureInventorySnapshots.corporationId, corporationId),
				isNotNull(corporationStructureInventorySnapshots.activatedAt)
			),
			orderBy: [
				desc(corporationStructureInventorySnapshots.activatedAt),
				desc(corporationStructureInventorySnapshots.createdAt),
			],
			columns: { id: true },
		})

		return snapshot?.id ?? null
	}

	private async createStructureInventorySnapshot(
		corporationId: string,
		createdAt: Date
	): Promise<string> {
		const [snapshot] = await this.getDb()
			.insert(corporationStructureInventorySnapshots)
			.values({ corporationId, createdAt })
			.returning({ id: corporationStructureInventorySnapshots.id })

		if (!snapshot) {
			throw new Error(`Failed to create structure inventory snapshot for ${corporationId}`)
		}

		return snapshot.id
	}

	private async activateStructureInventorySnapshot(
		corporationId: string,
		snapshotId: string,
		activatedAt: Date
	): Promise<void> {
		const [activatedSnapshot] = await this.getDb()
			.update(corporationStructureInventorySnapshots)
			.set({ activatedAt })
			.where(
				and(
					eq(corporationStructureInventorySnapshots.id, snapshotId),
					eq(corporationStructureInventorySnapshots.corporationId, corporationId)
				)
			)
			.returning({ id: corporationStructureInventorySnapshots.id })

		if (!activatedSnapshot) {
			throw new Error(`Failed to activate structure inventory snapshot ${snapshotId}`)
		}
	}

	private async cleanupOldStructureInventorySnapshots(
		corporationId: string,
		activeSnapshotId: string
	): Promise<void> {
		const db = this.getDb()
		const activeSnapshot = await db.query.corporationStructureInventorySnapshots.findFirst({
			where: and(
				eq(corporationStructureInventorySnapshots.id, activeSnapshotId),
				eq(corporationStructureInventorySnapshots.corporationId, corporationId)
			),
			columns: { activatedAt: true },
		})
		if (!activeSnapshot?.activatedAt) {
			return
		}

		for (let batchNumber = 0; batchNumber < INVENTORY_SNAPSHOT_CLEANUP_MAX_BATCHES; batchNumber++) {
			const snapshot = await db.query.corporationStructureInventorySnapshots.findFirst({
				where: and(
					eq(corporationStructureInventorySnapshots.corporationId, corporationId),
					ne(corporationStructureInventorySnapshots.id, activeSnapshotId),
					isNotNull(corporationStructureInventorySnapshots.activatedAt),
					lt(corporationStructureInventorySnapshots.activatedAt, activeSnapshot.activatedAt)
				),
				orderBy: [
					asc(corporationStructureInventorySnapshots.createdAt),
					asc(corporationStructureInventorySnapshots.id),
				],
				columns: { id: true },
			})
			if (!snapshot) {
				return
			}

			const inventoryRows = await db.query.corporationStructureInventory.findMany({
				where: eq(corporationStructureInventory.snapshotId, snapshot.id),
				columns: { id: true },
				limit: INVENTORY_SNAPSHOT_CLEANUP_BATCH_SIZE,
			})
			if (inventoryRows.length > 0) {
				await db.delete(corporationStructureInventory).where(
					and(
						eq(corporationStructureInventory.snapshotId, snapshot.id),
						inArray(
							corporationStructureInventory.id,
							inventoryRows.map((row) => row.id)
						)
					)
				)
				continue
			}

			await db
				.delete(corporationStructureInventorySnapshots)
				.where(eq(corporationStructureInventorySnapshots.id, snapshot.id))
		}
	}

	private async finalizeStructureInventorySnapshot(
		corporationId: string,
		snapshotId: string,
		activatedAt: Date
	): Promise<void> {
		await this.activateStructureInventorySnapshot(corporationId, snapshotId, activatedAt)
		try {
			await this.cleanupOldStructureInventorySnapshots(corporationId, snapshotId)
		} catch (error) {
			logger.warn('[EveCorporationData] Failed to clean up old structure inventory snapshots', {
				corporationId,
				snapshotId,
				error: error instanceof Error ? error.message : String(error),
			})
		}
	}

	private async *iterateStructureInventoryFromStoredAssets(
		corporationId: string,
		ownedStructureIds: ReadonlySet<string>
	): AsyncGenerator<StructureInventoryRowInput[], void, undefined> {
		for (const structureId of ownedStructureIds) {
			let lastItemId: string | null = null

			while (true) {
				const conditions = [
					eq(corporationAssets.corporationId, corporationId),
					eq(corporationAssets.locationId, structureId),
					eq(corporationAssets.locationType, 'item'),
				]
				if (lastItemId !== null) {
					conditions.push(gt(corporationAssets.itemId, lastItemId))
				}

				const rawAssets = await this.getDb().query.corporationAssets.findMany({
					where: and(...conditions),
					columns: {
						itemId: true,
						isSingleton: true,
						locationFlag: true,
						locationId: true,
						locationType: true,
						quantity: true,
						typeId: true,
					},
					orderBy: asc(corporationAssets.itemId),
					limit: STRUCTURE_INVENTORY_ASSET_BATCH_SIZE,
				})

				if (rawAssets.length === 0) {
					break
				}

				yield projectStructureInventoryFromStoredAssets(corporationId, ownedStructureIds, rawAssets)

				lastItemId = rawAssets[rawAssets.length - 1]?.itemId ?? null
				if (rawAssets.length < STRUCTURE_INVENTORY_ASSET_BATCH_SIZE || lastItemId === null) {
					break
				}
			}
		}
	}

	async storeStructureInventory(
		corporationId: string,
		inventory: StructureInventoryRowInput[]
	): Promise<void> {
		const ownedStructureIds = await this.getOwnedStructureIds(corporationId)
		const inventoryBatches = (async function* (): AsyncGenerator<
			StructureInventoryRowInput[],
			void,
			undefined
		> {
			const BATCH_SIZE = 100
			for (let i = 0; i < inventory.length; i += BATCH_SIZE) {
				yield inventory.slice(i, i + BATCH_SIZE)
			}
		})()

		await this.storeStructureInventoryBatches(corporationId, ownedStructureIds, inventoryBatches)
	}

	private async storeStructureInventoryBatches(
		corporationId: string,
		ownedStructureIds: ReadonlySet<string>,
		inventoryBatches: AsyncIterable<readonly StructureInventoryRowInput[]>
	): Promise<number> {
		const observedAt = new Date()
		const previousFuelSnapshotRows = ownedStructureIds.size
			? await this.getDb().query.corporationStructures.findMany({
					where: and(
						eq(corporationStructures.corporationId, corporationId),
						inArray(corporationStructures.structureId, [...ownedStructureIds])
					),
					columns: {
						structureId: true,
						lastFuelBlocks: true,
					},
				})
			: []
		const previousFuelBlockUnitsByStructure = new Map<string, number>()
		for (const row of previousFuelSnapshotRows) {
			if (row.lastFuelBlocks !== null) {
				previousFuelBlockUnitsByStructure.set(row.structureId, row.lastFuelBlocks)
			}
		}
		const db = this.getDb()
		const snapshotId = await this.createStructureInventorySnapshot(corporationId, observedAt)

		const fuelBlockUnitsByStructure = new Map<string, number>()
		for (const structureId of ownedStructureIds) {
			fuelBlockUnitsByStructure.set(structureId, 0)
		}

		let inventoryRowCount = 0
		for await (const batch of inventoryBatches) {
			const batchFuelBlockUnits = summarizeFuelBlockUnitsByStructure(ownedStructureIds, batch)
			for (const [structureId, fuelBlockUnits] of batchFuelBlockUnits) {
				fuelBlockUnitsByStructure.set(
					structureId,
					(fuelBlockUnitsByStructure.get(structureId) ?? 0) + fuelBlockUnits
				)
			}

			if (batch.length > 0) {
				await db.insert(corporationStructureInventory).values(
					batch.map((row) => ({
						corporationId: String(corporationId),
						snapshotId,
						structureId: row.structureId,
						itemId: row.itemId,
						isSingleton: row.isSingleton,
						locationFlag: row.locationFlag,
						locationType: row.locationType,
						quantity: row.quantity,
						typeId: row.typeId,
						updatedAt: observedAt,
					}))
				)
			}
			inventoryRowCount += batch.length
		}

		const refilledStructureIds = findRefilledStructureIds(
			previousFuelBlockUnitsByStructure,
			fuelBlockUnitsByStructure
		)

		if (ownedStructureIds.size > 0) {
			logger.info('[EveCorporationData] Processed structure fuel snapshot', {
				corporationId,
				ownedStructureCount: ownedStructureIds.size,
				inventoryRowCount,
				refilledStructureCount: refilledStructureIds.length,
				zeroFuelStructureCount: [...fuelBlockUnitsByStructure.values()].filter(
					(value) => value === 0
				).length,
			})
		}

		await this.finalizeStructureInventorySnapshot(corporationId, snapshotId, observedAt)

		if (ownedStructureIds.size > 0) {
			const snapshotRows = [...fuelBlockUnitsByStructure.entries()]
			const structureIds = snapshotRows.map(([structureId]) => structureId)
			const updatedStructures = await db
				.update(corporationStructures)
				.set({
					lastFuelBlocks: sql`case ${corporationStructures.structureId} ${sql.join(
						snapshotRows.map(
							([structureId, fuelBlockUnits]) => sql`when ${structureId} then ${fuelBlockUnits}`
						),
						sql` `
					)} else ${corporationStructures.lastFuelBlocks} end`,
					lastAssetSnapshotAt: observedAt,
				})
				.where(
					and(
						eq(corporationStructures.corporationId, corporationId),
						inArray(corporationStructures.structureId, structureIds)
					)
				)
				.returning({ structureId: corporationStructures.structureId })

			const updatedStructureIds = new Set(updatedStructures.map((row) => row.structureId))
			const missingStructureIds = structureIds.filter(
				(structureId) => !updatedStructureIds.has(structureId)
			)
			if (missingStructureIds.length > 0) {
				throw new Error(
					`Structure inventory snapshot did not cover ${missingStructureIds.length} owned structures for ${corporationId}: ${missingStructureIds.slice(0, 10).join(', ')}`
				)
			}
		}

		if (refilledStructureIds.length > 0) {
			await db
				.update(corporationStructures)
				.set({ lastRefilledAt: observedAt })
				.where(
					and(
						eq(corporationStructures.corporationId, corporationId),
						inArray(corporationStructures.structureId, refilledStructureIds)
					)
				)
		}

		return inventoryRowCount
	}

	private async getStructureInventoryNextAllowedAt(corporationId: string): Promise<Date | null> {
		const config = await this.getDb().query.corporationConfig.findFirst({
			where: eq(corporationConfig.corporationId, corporationId),
		})
		if (!config?.assetsLastSync) {
			return null
		}

		const nextAllowedAt = addHours(config.assetsLastSync, 1)
		return nextAllowedAt > new Date() ? nextAllowedAt : null
	}

	/**
	 * Fetch and store structure inventory using a specific director character.
	 * This avoids transferring large asset arrays across RPC boundaries.
	 */
	async syncAssetsWithDirector(
		corporationId: string,
		directorCharacterId: string
	): Promise<StructureInventorySyncResult> {
		this.assertNonNpcCorporation(corporationId)
		logger.info('[EveCorporationData] syncAssetsWithDirector invoked', {
			corporationId,
			directorCharacterId,
		})
		const nextAllowedAt = await this.getStructureInventoryNextAllowedAt(corporationId)
		if (nextAllowedAt) {
			logger.info('[EveCorporationData] Skipping structure inventory sync due to cooldown', {
				corporationId,
				nextAllowedAt: nextAllowedAt.toISOString(),
			})
			return {
				assetsCount: 0,
				snapshotUpdated: false,
				skipReason: 'cooldown',
				ownedStructureCount: null,
				fetchedAssetCount: 0,
				inventoryRowCount: 0,
			}
		}
		await this.requireCorpRole(corporationId, directorCharacterId, ['Director'])
		return await this.fetchAndStoreStructureInventoryByCharacter(corporationId, directorCharacterId)
	}

	private async hydrateStructureRows(
		corporationId: string,
		structures: EsiCorporationStructure[]
	): Promise<
		Array<{
			corporationId: string
			structureId: string
			name: string
			typeId: string
			typeName: string | null
			systemId: string
			systemName: string | null
			regionId: string | null
			regionName: string | null
			profileId: string
			fuelExpires: Date | null
			fuelAmount: number | null
			nextReinforceApply: Date | null
			nextReinforceHour: number | null
			reinforceHour: number | null
			state: string
			stateTimerEnd: Date | null
			stateTimerStart: Date | null
			unanchorsAt: Date | null
			lowPower: boolean
			syncStatus: 'ok' | 'warning' | 'error'
			syncFailureReason: string | null
			lastSyncedAt: Date | null
			services: Array<{ name: string; state: string }> | null
			fuelBurnRate: string | null
			structureInfo: EsiGetStructureResponse | null
			updatedAt: Date
		}>
	> {
		if (structures.length === 0) {
			return []
		}

		const structureIds = structures.map((structure) => structure.structure_id)
		const existingStructures = await this.getDb().query.corporationStructures.findMany({
			where: and(
				eq(corporationStructures.corporationId, corporationId),
				inArray(corporationStructures.structureId, structureIds)
			),
		})
		const existingByStructureId = new Map(
			existingStructures.map((structure) => [structure.structureId, structure] as const)
		)
		const structuresNeedingStaticHydration = structures.filter(
			(structure) =>
				!hasCompleteStructureStaticHydration(
					existingByStructureId.get(structure.structure_id) ?? null
				)
		)

		const directorManager = this.createDirectorManager(corporationId)
		const director = await directorManager.selectDirector()
		const characterId = director ? String(director.characterId) : null
		const universe = getStub<Universe>(this.env.UNIVERSE, 'default')
		const tokenStore = this.getEveTokenStoreStub()
		const systemIds = [
			...new Set(structuresNeedingStaticHydration.map((structure) => structure.system_id)),
		]
		const typeIds = [
			...new Set(structuresNeedingStaticHydration.map((structure) => structure.type_id)),
		]

		const [systemsById, regionsBySystemId, typeNamesById, structureInfos] = await Promise.all([
			systemIds.length > 0
				? withRpcResult(universe.resolveSolarSystemsByIds(systemIds), cloneRpcRecord)
				: Promise.resolve({} as Record<string, UniverseSolarSystem | null>),
			systemIds.length > 0
				? withRpcResult(universe.getRegionsBySystemIds(systemIds), cloneRpcRecord)
				: Promise.resolve({} as Record<string, { regionId: string; regionName: string }>),
			typeIds.length > 0
				? withRpcResult(tokenStore.resolveIds(typeIds), (names) => ({ ...names }))
				: Promise.resolve({} as Record<string, string>),
			characterId
				? Promise.all(
						structures.map(async (structure) => {
							if (isSpecialStructureTab(getStructureTabForTypeId(structure.type_id))) {
								return null
							}

							try {
								// Moon-drills need universe hydration so we can later infer the
								// attached moon from the returned coordinates.
								return await withRpcResult(
									universe.getStructureInfo(
										structure.structure_id as EveStructureId,
										characterId as EveCharacterId
									),
									(structureInfo) => (structureInfo ? { ...structureInfo } : null)
								)
							} catch (error) {
								logger.warn('[EveCorporationData] Failed to hydrate structure name', {
									corporationId,
									structureId: structure.structure_id,
									error: error instanceof Error ? error.message : String(error),
								})
								return null
							}
						})
					)
				: Promise.resolve(structures.map(() => null)),
		])

		return structures.map((structure, index) => {
			const structureInfo = structureInfos[index]
			const existing = existingByStructureId.get(structure.structure_id) ?? null
			const system = systemsById[structure.system_id]
			const region = regionsBySystemId[structure.system_id]
			const isSpecialStructure = isSpecialStructureTab(getStructureTabForTypeId(structure.type_id))
			const resolvedName = structureInfo?.name ?? null
			const resolvedTypeName = existing?.typeName || typeNamesById[structure.type_id] || null
			const resolvedSystemName = existing?.systemName || system?.solarSystemName || null
			const resolvedRegionId = existing?.regionId || region?.regionId || null
			const resolvedRegionName = existing?.regionName || region?.regionName || null
			const lowPower = !structure.services?.some((service) => service.state === 'online')
			const hydrationComplete =
				(isSpecialStructure || resolvedName !== null) &&
				resolvedTypeName !== null &&
				resolvedSystemName !== null &&
				resolvedRegionId !== null &&
				resolvedRegionName !== null
			const syncStatus: 'ok' | 'warning' | 'error' = hydrationComplete ? 'ok' : 'warning'
			const syncFailureReason = hydrationComplete
				? null
				: 'Structure details could not be fully hydrated during sync'
			const hydrated = preserveStructureHydrationFields(existing, {
				name: resolvedName,
				typeName: resolvedTypeName,
				systemName: resolvedSystemName,
				regionName: resolvedRegionName,
				syncStatus,
				syncFailureReason,
			})

			return {
				corporationId: String(corporationId),
				structureId: structure.structure_id,
				name: hydrated.name ?? structure.structure_id,
				typeId: structure.type_id,
				typeName: hydrated.typeName,
				systemId: structure.system_id,
				systemName: hydrated.systemName,
				regionId: resolvedRegionId,
				regionName: hydrated.regionName,
				profileId: structure.profile_id,
				fuelExpires: structure.fuel_expires ? new Date(structure.fuel_expires) : null,
				fuelAmount: null,
				nextReinforceApply: structure.next_reinforce_apply
					? new Date(structure.next_reinforce_apply)
					: null,
				nextReinforceHour: structure.next_reinforce_hour ?? null,
				reinforceHour: structure.reinforce_hour ?? null,
				state: structure.state,
				stateTimerEnd: structure.state_timer_end ? new Date(structure.state_timer_end) : null,
				stateTimerStart: structure.state_timer_start ? new Date(structure.state_timer_start) : null,
				unanchorsAt: structure.unanchors_at ? new Date(structure.unanchors_at) : null,
				lowPower,
				syncStatus: hydrated.syncStatus,
				syncFailureReason: hydrated.syncFailureReason,
				lastSyncedAt: new Date(),
				services: structure.services || null,
				fuelBurnRate: existing?.fuelBurnRate ?? null,
				structureInfo: structureInfo ?? null,
				updatedAt: new Date(),
			}
		})
	}

	private async resolveStructureFuelBurnRates(
		corporationId: string,
		structures: ReadonlyArray<{
			structureId: string
			typeId: string
			services: Array<{ name: string; state: string }> | null
			fuelBurnRate: string | null
		}>
	): Promise<
		Map<
			string,
			{
				fuelBurnRate: string | null
				unresolvedServiceNames: string[]
				unresolvedModuleTypeIds: string[]
			}
		>
	> {
		const fuelBurnRateByStructure = new Map<
			string,
			{
				fuelBurnRate: string | null
				unresolvedServiceNames: string[]
				unresolvedModuleTypeIds: string[]
			}
		>(
			structures.map(
				(structure) =>
					[
						structure.structureId,
						{
							fuelBurnRate: structure.fuelBurnRate,
							unresolvedServiceNames: [],
							unresolvedModuleTypeIds: [],
						},
					] as const
			)
		)
		if (structures.length === 0) {
			return fuelBurnRateByStructure
		}

		const structureTypeIds = [...new Set(structures.map((structure) => structure.typeId))]
		let serviceModuleTypeIdsByStructureId = new Map<string, string[]>()
		try {
			serviceModuleTypeIdsByStructureId = await this.getStructureServiceModuleTypeIds(
				corporationId,
				structures.map((structure) => structure.structureId)
			)
		} catch (error) {
			logger.warn('[EveCorporationData] Failed to read stored structure service modules', {
				corporationId,
				error: error instanceof Error ? error.message : String(error),
			})
		}
		const serviceModuleTypeIds = [
			...new Set([...serviceModuleTypeIdsByStructureId.values()].flatMap((typeIds) => typeIds)),
		]
		const serviceNames = [
			...new Set(
				structures.flatMap((structure) => {
					if ((serviceModuleTypeIdsByStructureId.get(structure.structureId)?.length ?? 0) > 0) {
						return []
					}

					return (structure.services ?? [])
						.filter((service) => service.state.trim().toLowerCase() === 'online')
						.map((service) => service.name)
				})
			),
		]

		try {
			const universe = getStub<Universe>(this.env.UNIVERSE, 'default')
			const fuelRules = await withRpcResult(
				universe.resolveStructureFuelRules(structureTypeIds, serviceNames, serviceModuleTypeIds),
				(result) => ({ ...result })
			)
			const modulesByServiceName = new Map<string, UniverseFuelModuleRule>()
			const modulesByTypeId = new Map<string, UniverseFuelModuleRule>()
			for (const [serviceName, module] of Object.entries(fuelRules.modulesByServiceName)) {
				if (module !== null) {
					modulesByServiceName.set(normalizeUniverseServiceName(serviceName), module)
				}
			}
			for (const [typeId, module] of Object.entries(fuelRules.modulesByTypeId)) {
				if (module !== null) {
					modulesByTypeId.set(typeId, module)
				}
			}

			if (fuelRules.unresolvedServiceNames.length > 0) {
				logger.warn('[EveCorporationData] Unresolved online structure services', {
					corporationId,
					unresolvedServiceNames: fuelRules.unresolvedServiceNames,
					sdeVersion: fuelRules.sdeVersion,
				})
			}
			if (fuelRules.missingStructureTypeIds.length > 0) {
				logger.warn('[EveCorporationData] Structure types missing from SDE fuel rules', {
					corporationId,
					missingStructureTypeIds: fuelRules.missingStructureTypeIds,
					sdeVersion: fuelRules.sdeVersion,
				})
			}

			for (const structure of structures) {
				const installedModuleTypeIds =
					serviceModuleTypeIdsByStructureId.get(structure.structureId) ?? []
				const fuelResult = calculateStructureFuelBurnRateDetails(
					structure.services,
					modulesByServiceName,
					fuelRules.structureModifiersByTypeId[structure.typeId] ?? [],
					fuelRules.builtInModulesByStructureTypeId[structure.typeId] ?? null,
					installedModuleTypeIds,
					modulesByTypeId
				)
				if (
					fuelResult.unresolvedServiceNames.length > 0 ||
					fuelResult.unresolvedModuleTypeIds.length > 0
				) {
					logger.warn(
						'[EveCorporationData] Some online service modules could not be identified for fuel consumption',
						{
							corporationId,
							structureId: structure.structureId,
							structureTypeId: structure.typeId,
							unresolvedServiceNames: fuelResult.unresolvedServiceNames,
							unresolvedModuleTypeIds: fuelResult.unresolvedModuleTypeIds,
							installedModuleTypeIds,
							sdeVersion: fuelRules.sdeVersion,
						}
					)
				}
				fuelBurnRateByStructure.set(structure.structureId, {
					fuelBurnRate:
						fuelResult.fuelBurnRate === null ? null : fuelResult.fuelBurnRate.toFixed(4),
					unresolvedServiceNames: fuelResult.unresolvedServiceNames,
					unresolvedModuleTypeIds: fuelResult.unresolvedModuleTypeIds,
				})
			}
		} catch (error) {
			logger.warn('[EveCorporationData] Failed to resolve deterministic structure fuel rules', {
				corporationId,
				error: error instanceof Error ? error.message : String(error),
			})
		}

		return fuelBurnRateByStructure
	}

	private async getStructureServiceModuleTypeIds(
		corporationId: string,
		structureIds: readonly string[]
	): Promise<Map<string, string[]>> {
		if (structureIds.length === 0) {
			return new Map()
		}

		const rows = await this.getDb()
			.select({
				structureId: corporationAssets.locationId,
				typeId: corporationAssets.typeId,
			})
			.from(corporationAssets)
			.where(
				and(
					eq(corporationAssets.corporationId, corporationId),
					eq(corporationAssets.locationType, 'item'),
					inArray(corporationAssets.locationId, [...structureIds]),
					like(corporationAssets.locationFlag, 'ServiceSlot%')
				)
			)

		const typeIdsByStructureId = new Map<string, string[]>()
		for (const row of rows) {
			const typeIds = typeIdsByStructureId.get(row.structureId) ?? []
			if (!typeIds.includes(row.typeId)) {
				typeIds.push(row.typeId)
			}
			typeIdsByStructureId.set(row.structureId, typeIds)
		}

		return typeIdsByStructureId
	}

	private async refreshStoredStructureFuelBurnRates(
		corporationId: string,
		structureIds?: readonly string[]
	): Promise<void> {
		const conditions = [eq(corporationStructures.corporationId, corporationId)]
		if (structureIds && structureIds.length > 0) {
			conditions.push(inArray(corporationStructures.structureId, [...structureIds]))
		}
		const structures = await this.getDb().query.corporationStructures.findMany({
			where: and(...conditions),
			columns: {
				structureId: true,
				typeId: true,
				services: true,
				fuelBurnRate: true,
				syncStatus: true,
				syncFailureReason: true,
			},
		})
		if (structures.length === 0) {
			return
		}

		const fuelBurnRateByStructure = await this.resolveStructureFuelBurnRates(
			corporationId,
			structures
		)
		const rows = [...fuelBurnRateByStructure.entries()]
		if (rows.length === 0) {
			return
		}

		await this.getDb()
			.update(corporationStructures)
			.set({
				fuelBurnRate: sql`case ${corporationStructures.structureId} ${sql.join(
					rows.map(([structureId, result]) => sql`when ${structureId} then ${result.fuelBurnRate}`),
					sql` `
				)} else ${corporationStructures.fuelBurnRate} end`,
				syncStatus: sql`case ${corporationStructures.structureId} ${sql.join(
					rows.map(([structureId, result]) => {
						return result.unresolvedServiceNames.length > 0 ||
							result.unresolvedModuleTypeIds.length > 0
							? sql`when ${structureId} then ${'error'}`
							: sql`when ${structureId} then case when ${corporationStructures.syncFailureReason} = ${STRUCTURE_FUEL_SYNC_FAILURE_REASON} then ${'ok'} else ${corporationStructures.syncStatus} end`
					}),
					sql` `
				)} else ${corporationStructures.syncStatus} end`,
				syncFailureReason: sql`case ${corporationStructures.structureId} ${sql.join(
					rows.map(([structureId, result]) => {
						return result.unresolvedServiceNames.length > 0 ||
							result.unresolvedModuleTypeIds.length > 0
							? sql`when ${structureId} then ${STRUCTURE_FUEL_SYNC_FAILURE_REASON}`
							: sql`when ${structureId} then case when ${corporationStructures.syncFailureReason} = ${STRUCTURE_FUEL_SYNC_FAILURE_REASON} then null else ${corporationStructures.syncFailureReason} end`
					}),
					sql` `
				)} else ${corporationStructures.syncFailureReason} end`,
			})
			.where(
				and(
					eq(corporationStructures.corporationId, corporationId),
					inArray(
						corporationStructures.structureId,
						rows.map(([structureId]) => structureId)
					)
				)
			)
	}

	/**
	 * Store structures (workflow-friendly)
	 */
	async storeStructures(corporationId: string, structures: any[]): Promise<void> {
		const hydratedStructures = await this.hydrateStructureRows(
			corporationId,
			structures as EsiCorporationStructure[]
		)
		const fuelBurnRateByStructure = await this.resolveStructureFuelBurnRates(
			corporationId,
			hydratedStructures
		)
		const structureIds = hydratedStructures.map((structure) => structure.structureId)
		const existingStructureRows = await this.getDb().query.corporationStructures.findMany({
			where: eq(corporationStructures.corporationId, corporationId),
			columns: {
				structureId: true,
				typeId: true,
				updatedAt: true,
			},
		})
		const currentStructureIds = new Set(structureIds)
		const departedStructureIds = filterPrunableStructureIds(
			existingStructureRows.filter((row) => row.typeId !== ORBITAL_SKYHOOK_TYPE_ID),
			currentStructureIds,
			new Date()
		)
		const BATCH_SIZE = STRUCTURE_SNAPSHOT_BATCH_SIZE

		for (let i = 0; i < hydratedStructures.length; i += BATCH_SIZE) {
			const batch = hydratedStructures.slice(i, i + BATCH_SIZE)
			const batchValues = batch.map((structure) => {
				const fuelResult = fuelBurnRateByStructure.get(structure.structureId)
				const hasUnresolvedFuelModules =
					(fuelResult?.unresolvedServiceNames.length ?? 0) > 0 ||
					(fuelResult?.unresolvedModuleTypeIds.length ?? 0) > 0

				return {
					...structure,
					syncStatus: hasUnresolvedFuelModules ? 'error' : structure.syncStatus,
					syncFailureReason: hasUnresolvedFuelModules
						? STRUCTURE_FUEL_SYNC_FAILURE_REASON
						: structure.syncFailureReason,
					fuelBurnRate: fuelResult?.fuelBurnRate ?? null,
				}
			})

			await this.getDb()
				.insert(corporationStructures)
				.values(batchValues)
				.onConflictDoUpdate({
					target: corporationStructures.structureId,
					set: {
						name: sql`excluded.name`,
						typeId: sql`excluded.type_id`,
						typeName: sql`excluded.type_name`,
						systemId: sql`excluded.system_id`,
						systemName: sql`excluded.system_name`,
						regionId: sql`excluded.region_id`,
						regionName: sql`excluded.region_name`,
						profileId: sql`excluded.profile_id`,
						fuelExpires: sql`excluded.fuel_expires`,
						fuelAmount: sql`excluded.fuel_amount`,
						nextReinforceApply: sql`excluded.next_reinforce_apply`,
						nextReinforceHour: sql`excluded.next_reinforce_hour`,
						reinforceHour: sql`excluded.reinforce_hour`,
						state: sql`excluded.state`,
						stateTimerEnd: sql`excluded.state_timer_end`,
						stateTimerStart: sql`excluded.state_timer_start`,
						unanchorsAt: sql`excluded.unanchors_at`,
						lowPower: sql`excluded.low_power`,
						syncStatus: sql`excluded.sync_status`,
						syncFailureReason: sql`excluded.sync_failure_reason`,
						lastSyncedAt: sql`excluded.last_synced_at`,
						services: sql`excluded.services`,
						fuelBurnRate: sql`excluded.fuel_burn_rate`,
						updatedAt: sql`excluded.updated_at`,
					},
				})
		}

		await deleteIdsInBatches(departedStructureIds, STRUCTURE_CLEANUP_BATCH_SIZE, async (batch) => {
			await this.getDb()
				.delete(corporationStructures)
				.where(
					and(
						eq(corporationStructures.corporationId, corporationId),
						inArray(corporationStructures.structureId, batch)
					)
				)
		})
		await this.storeMoonGeographies(corporationId, hydratedStructures)
		await this.storeMoonDrills(corporationId, hydratedStructures)
	}

	private async storeMoonDrills(
		corporationId: string,
		structures: Array<{
			structureId: string
			corporationId: string
			typeId: string
			typeName: string | null
		}>
	): Promise<void> {
		const now = new Date()
		const moonDrillStructures = structures.filter(
			(structure) =>
				getStructureTabForTypeId(structure.typeId, structure.typeName) === 'moon-drills'
		)
		const existingRows = await this.getDb().query.structureMoonDrills.findMany({
			where: eq(structureMoonDrills.corporationId, corporationId),
			columns: {
				structureId: true,
				updatedAt: true,
			},
		})

		if (moonDrillStructures.length === 0) {
			const currentStructureIds = new Set<string>()
			const departedStructureIds = filterPrunableStructureIds(
				existingRows,
				currentStructureIds,
				now
			)

			await deleteIdsInBatches(
				departedStructureIds,
				STRUCTURE_CLEANUP_BATCH_SIZE,
				async (batch) => {
					await this.getDb()
						.delete(structureMoonDrills)
						.where(
							and(
								eq(structureMoonDrills.corporationId, corporationId),
								inArray(structureMoonDrills.structureId, batch)
							)
						)
				}
			)
			return
		}

		const synthesizedRows = moonDrillStructures
			.map((structure) =>
				buildMoonDrillStorageRow({
					corporationId,
					structure,
					observedAt: now,
				})
			)
			.filter((row): row is MoonDrillStorageRow => row !== null)

		if (synthesizedRows.length === 0) {
			logger.warn('[storeMoonDrills] Could not synthesize moon drill snapshot rows', {
				corporationId,
				structureCount: moonDrillStructures.length,
			})
			return
		}

		const BATCH_SIZE = STRUCTURE_SNAPSHOT_BATCH_SIZE

		for (let i = 0; i < synthesizedRows.length; i += BATCH_SIZE) {
			const batch = synthesizedRows.slice(i, i + BATCH_SIZE)
			await this.getDb()
				.insert(structureMoonDrills)
				.values(batch.map((row) => ({ ...row, updatedAt: now })))
				.onConflictDoUpdate({
					target: structureMoonDrills.structureId,
					set: {
						corporationId: sql`excluded.corporation_id`,
						sourceSyncAt: sql`excluded.source_sync_at`,
						lastSyncedAt: sql`excluded.last_synced_at`,
						syncFailureReason: sql`excluded.sync_failure_reason`,
						updatedAt: sql`excluded.updated_at`,
					},
				})
		}

		const currentStructureIds = new Set(
			moonDrillStructures.map((structure) => structure.structureId)
		)
		const departedStructureIds = filterPrunableStructureIds(existingRows, currentStructureIds, now)

		await deleteIdsInBatches(departedStructureIds, STRUCTURE_CLEANUP_BATCH_SIZE, async (batch) => {
			await this.getDb()
				.delete(structureMoonDrills)
				.where(
					and(
						eq(structureMoonDrills.corporationId, corporationId),
						inArray(structureMoonDrills.structureId, batch)
					)
				)
		})
	}

	private async storeMoonGeographies(
		corporationId: string,
		structures: Array<{
			structureId: string
			corporationId: string
			typeId: string
			typeName: string | null
			systemId: string
			systemName: string | null
			structureInfo: EsiGetStructureResponse | null
		}>
	): Promise<void> {
		const now = new Date()
		const moonGeographyStructures = structures.filter((structure) =>
			['moon-drills', 'mining-citadels'].includes(
				getStructureTabForTypeId(structure.typeId, structure.typeName)
			)
		)

		const existingRows = await this.getDb().query.structureMoonGeographies.findMany({
			where: eq(structureMoonGeographies.corporationId, corporationId),
			columns: {
				structureId: true,
				updatedAt: true,
			},
		})
		const existingStructureIds = new Set(existingRows.map((row) => row.structureId))
		const newMoonGeographyStructures = moonGeographyStructures.filter(
			(structure) => !existingStructureIds.has(structure.structureId)
		)

		if (moonGeographyStructures.length === 0) {
			const departedStructureIds = filterPrunableStructureIds(existingRows, new Set<string>(), now)

			await deleteIdsInBatches(
				departedStructureIds,
				STRUCTURE_CLEANUP_BATCH_SIZE,
				async (batch) => {
					await this.getDb()
						.delete(structureMoonGeographies)
						.where(
							and(
								eq(structureMoonGeographies.corporationId, corporationId),
								inArray(structureMoonGeographies.structureId, batch)
							)
						)
				}
			)
			return
		}

		const universe = getStub<Universe>(this.env.UNIVERSE, 'default')
		const synthesizedRows = (
			await Promise.all(
				newMoonGeographyStructures.map(async (structure) => {
					if (!structure.structureInfo) {
						return null
					}

					try {
						const moonGeography = await withRpcResult(
							universe.resolveNearestMoonGeographyBySystemPosition(
								structure.systemId,
								structure.structureInfo.position
							),
							(geography) => (geography ? { ...geography } : null)
						)

						return buildMoonGeographyStorageRow({
							corporationId,
							structure,
							moonGeography,
							observedAt: now,
						})
					} catch (error) {
						logger.warn('[storeMoonGeographies] Failed to resolve moon geography for structure', {
							corporationId,
							structureId: structure.structureId,
							error: error instanceof Error ? error.message : String(error),
						})
						return null
					}
				})
			)
		).filter((row): row is MoonGeographyStorageRow => row !== null)

		const synthesisComplete = synthesizedRows.length === newMoonGeographyStructures.length
		if (!synthesisComplete) {
			logger.warn(
				'[storeMoonGeographies] Preserving existing moon geography snapshot because synthesis failed',
				{
					corporationId,
					structureCount: newMoonGeographyStructures.length,
				}
			)
			return
		}

		const BATCH_SIZE = STRUCTURE_SNAPSHOT_BATCH_SIZE

		for (let i = 0; i < synthesizedRows.length; i += BATCH_SIZE) {
			const batch = synthesizedRows.slice(i, i + BATCH_SIZE)
			await this.getDb()
				.insert(structureMoonGeographies)
				.values(batch.map((row) => ({ ...row, updatedAt: now })))
				.onConflictDoUpdate({
					target: structureMoonGeographies.structureId,
					set: {
						corporationId: sql`excluded.corporation_id`,
						moonId: sql`excluded.moon_id`,
						moonName: sql`excluded.moon_name`,
						planetId: sql`excluded.planet_id`,
						planetName: sql`excluded.planet_name`,
						systemId: sql`excluded.system_id`,
						systemName: sql`excluded.system_name`,
						sourceSyncAt: sql`excluded.source_sync_at`,
						lastSyncedAt: sql`excluded.last_synced_at`,
						updatedAt: sql`excluded.updated_at`,
					},
				})
		}

		const currentStructureIds = new Set(
			moonGeographyStructures.map((structure) => structure.structureId)
		)
		const departedStructureIds = filterPrunableStructureIds(existingRows, currentStructureIds, now)

		await deleteIdsInBatches(departedStructureIds, STRUCTURE_CLEANUP_BATCH_SIZE, async (batch) => {
			await this.getDb()
				.delete(structureMoonGeographies)
				.where(
					and(
						eq(structureMoonGeographies.corporationId, corporationId),
						inArray(structureMoonGeographies.structureId, batch)
					)
				)
		})
	}

	/**
	 * Store market orders (workflow-friendly)
	 */
	async storeOrders(corporationId: string, orders: any[]): Promise<void> {
		const BATCH_SIZE = 25
		for (let i = 0; i < orders.length; i += BATCH_SIZE) {
			const batch = orders.slice(i, i + BATCH_SIZE)
			const valuesToInsert = batch.map((order) => ({
				corporationId: String(corporationId),
				orderId: order.order_id,
				duration: order.duration,
				escrow: order.escrow?.toString() || null,
				isBuyOrder: order.is_buy_order,
				issued: new Date(order.issued),
				issuedBy: order.issued_by,
				locationId: order.location_id,
				minVolume: order.min_volume ?? null,
				price: order.price.toString(),
				range: order.range,
				regionId: order.region_id,
				typeId: order.type_id,
				volumeRemain: order.volume_remain,
				volumeTotal: order.volume_total,
				walletDivision: order.wallet_division,
				updatedAt: new Date(),
			}))

			await this.getDb()
				.insert(corporationOrders)
				.values(valuesToInsert)
				.onConflictDoUpdate({
					target: [corporationOrders.corporationId, corporationOrders.orderId],
					set: {
						volumeRemain: sql`excluded.volume_remain`,
						price: sql`excluded.price`,
						updatedAt: sql`excluded.updated_at`,
					},
				})
		}
	}

	async rebuildStructureInventorySnapshot(
		corporationId: string,
		structureId: string
	): Promise<{ inventoryCount: number }> {
		this.assertNonNpcCorporation(corporationId)

		const ownedStructureIds = new Set([String(structureId)])
		const db = this.getDb()
		const activeSnapshotId = await this.getActiveStructureInventorySnapshotId(corporationId)
		const observedAt = new Date()
		const snapshotId = await this.createStructureInventorySnapshot(corporationId, observedAt)

		if (activeSnapshotId !== null) {
			const existingRows = db
				.select({
					id: sql<string>`gen_random_uuid()`.as('id'),
					corporationId: corporationStructureInventory.corporationId,
					snapshotId: sql<string>`${snapshotId}`.as('snapshotId'),
					structureId: corporationStructureInventory.structureId,
					itemId: corporationStructureInventory.itemId,
					isSingleton: corporationStructureInventory.isSingleton,
					locationFlag: corporationStructureInventory.locationFlag,
					locationType: corporationStructureInventory.locationType,
					quantity: corporationStructureInventory.quantity,
					typeId: corporationStructureInventory.typeId,
					updatedAt: corporationStructureInventory.updatedAt,
				})
				.from(corporationStructureInventory)
				.where(
					and(
						eq(corporationStructureInventory.corporationId, corporationId),
						eq(corporationStructureInventory.snapshotId, activeSnapshotId),
						ne(corporationStructureInventory.structureId, String(structureId))
					)
				)

			await db.insert(corporationStructureInventory).select(existingRows)
		}

		let inventoryCount = 0
		for await (const batch of this.iterateStructureInventoryFromStoredAssets(
			corporationId,
			ownedStructureIds
		)) {
			if (batch.length > 0) {
				await db.insert(corporationStructureInventory).values(
					batch.map((row) => ({
						corporationId: String(corporationId),
						snapshotId,
						structureId: row.structureId,
						itemId: row.itemId,
						isSingleton: row.isSingleton,
						locationFlag: row.locationFlag,
						locationType: row.locationType,
						quantity: row.quantity,
						typeId: row.typeId,
						updatedAt: observedAt,
					}))
				)
			}
			inventoryCount += batch.length
		}

		await this.finalizeStructureInventorySnapshot(corporationId, snapshotId, observedAt)

		const [updatedStructure] = await db
			.update(corporationStructures)
			.set({ lastAssetSnapshotAt: observedAt })
			.where(
				and(
					eq(corporationStructures.corporationId, corporationId),
					eq(corporationStructures.structureId, String(structureId))
				)
			)
			.returning({ structureId: corporationStructures.structureId })
		if (!updatedStructure) {
			throw new Error(
				`Failed to mark structure inventory snapshot as current for ${corporationId}/${structureId}`
			)
		}

		try {
			await this.refreshStoredStructureFuelBurnRates(corporationId, [String(structureId)])
		} catch (error) {
			logger.warn(
				'[EveCorporationData] Failed to refresh structure fuel rate after inventory rebuild',
				{
					corporationId,
					structureId: String(structureId),
					error: error instanceof Error ? error.message : String(error),
				}
			)
		}

		logger.info('[EveCorporationData] Rebuilt structure inventory snapshot from stored assets', {
			corporationId,
			structureId: String(structureId),
			inventoryCount,
		})

		return { inventoryCount }
	}

	/**
	 * Store contracts (workflow-friendly)
	 */
	async storeContracts(corporationId: string, contracts: any[]): Promise<void> {
		await this.replaceContractsSnapshot(corporationId, contracts as EsiCorporationContract[])
	}

	/**
	 * Store industry jobs (workflow-friendly)
	 */
	async storeIndustryJobs(corporationId: string, jobs: any[]): Promise<void> {
		const BATCH_SIZE = 20
		for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
			const batch = jobs.slice(i, i + BATCH_SIZE)
			const valuesToInsert = batch.map((job) => ({
				corporationId: String(corporationId),
				jobId: job.job_id,
				installerId: job.installer_id,
				facilityId: job.facility_id,
				locationId: job.location_id,
				activityId: job.activity_id,
				blueprintId: job.blueprint_id,
				blueprintTypeId: job.blueprint_type_id,
				blueprintLocationId: job.blueprint_location_id,
				outputLocationId: job.output_location_id,
				runs: job.runs,
				cost: job.cost?.toString() || null,
				licensedRuns: job.licensed_runs ?? null,
				probability: job.probability?.toString() || null,
				productTypeId: job.product_type_id || null,
				status: job.status,
				duration: job.duration,
				startDate: new Date(job.start_date),
				endDate: new Date(job.end_date),
				pauseDate: job.pause_date ? new Date(job.pause_date) : null,
				completedDate: job.completed_date ? new Date(job.completed_date) : null,
				completedCharacterId: job.completed_character_id || null,
				successfulRuns: job.successful_runs ?? null,
				updatedAt: new Date(),
			}))

			await this.getDb()
				.insert(corporationIndustryJobs)
				.values(valuesToInsert)
				.onConflictDoUpdate({
					target: [corporationIndustryJobs.corporationId, corporationIndustryJobs.jobId],
					set: {
						status: sql`excluded.status`,
						pauseDate: sql`excluded.pause_date`,
						completedDate: sql`excluded.completed_date`,
						completedCharacterId: sql`excluded.completed_character_id`,
						successfulRuns: sql`excluded.successful_runs`,
						updatedAt: sql`excluded.updated_at`,
					},
				})
		}
	}

	/**
	 * Store killmails (workflow-friendly)
	 */
	async storeKillmails(corporationId: string, killmails: any[]): Promise<void> {
		const BATCH_SIZE = 50
		for (let i = 0; i < killmails.length; i += BATCH_SIZE) {
			const batch = killmails.slice(i, i + BATCH_SIZE)
			const valuesToInsert = batch.map((km) => ({
				corporationId: String(corporationId),
				killmailId: km.killmail_id,
				killmailHash: km.killmail_hash,
				killmailTime: new Date(),
				updatedAt: new Date(),
			}))

			await this.getDb()
				.insert(corporationKillmails)
				.values(valuesToInsert)
				.onConflictDoUpdate({
					target: [corporationKillmails.corporationId, corporationKillmails.killmailId],
					set: {
						killmailHash: sql`excluded.killmail_hash`,
						updatedAt: sql`excluded.updated_at`,
					},
				})
		}
	}

	// ========================================================================
	// FETCH AND STORE METHODS (private)
	// ========================================================================

	/**
	 * Fetch and store public corporation information
	 */
	private async fetchAndStorePublicInfo(
		corporationId: string,
		_forceRefresh = false
	): Promise<void> {
		const previousInfo = await this.getDb().query.corporationPublicInfo.findFirst({
			where: eq(corporationPublicInfo.corporationId, corporationId),
			columns: { allianceId: true },
		})

		const tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		const data = await esiFetch.fetchPublicInfo(tokenStore, corporationId)

		await this.upsertPublicInfo(corporationId, data as CorporationPublicData)

		const previousAllianceId = previousInfo?.allianceId ?? null
		const nextAllianceId = data.allianceId ?? null
		if (previousAllianceId !== nextAllianceId) {
			const members = await this.getDb()
				.select({ characterId: corporationMembers.characterId })
				.from(corporationMembers)
				.where(eq(corporationMembers.corporationId, corporationId))
			const characterIds = members.map((row) => row.characterId)

			if (characterIds.length > 0) {
				try {
					const result = await withRpcResult(
						this.env.CORE.addPendingDiscordRefreshesForCharacters(characterIds),
						(result) => ({ ...result })
					)
					logger.info(
						'[EveCorporationData] Queued Discord refresh after alliance affiliation change',
						{
							corporationId,
							previousAllianceId,
							nextAllianceId,
							charactersMatched: characterIds.length,
							usersQueued: result.usersQueued,
							pendingCount: result.pendingCount,
						}
					)
				} catch (error) {
					logger.error(
						'[EveCorporationData] Failed to queue Discord refresh after alliance affiliation change',
						{
							corporationId,
							previousAllianceId,
							nextAllianceId,
							error: error instanceof Error ? error.message : String(error),
						}
					)
				}
			}
		}
	}

	private async upsertPublicInfo(
		corporationId: string,
		publicInfo: CorporationPublicData
	): Promise<void> {
		await this.getDb()
			.insert(corporationPublicInfo)
			.values({
				...publicInfo,
				updatedAt: new Date(),
			})
			.onConflictDoUpdate({
				target: corporationPublicInfo.corporationId,
				set: {
					name: publicInfo.name,
					ticker: publicInfo.ticker,
					ceoId: publicInfo.ceoId,
					creatorId: publicInfo.creatorId,
					dateFounded: publicInfo.dateFounded,
					description: publicInfo.description,
					homeStationId: publicInfo.homeStationId,
					memberCount: publicInfo.memberCount,
					shares: publicInfo.shares,
					taxRate: publicInfo.taxRate,
					url: publicInfo.url,
					allianceId: publicInfo.allianceId,
					factionId: publicInfo.factionId,
					warEligible: publicInfo.warEligible,
					updatedAt: sql`excluded.updated_at`,
				},
			})

		const storedPublicInfo = await this.getCorporationInfo(corporationId)
		if (
			!storedPublicInfo ||
			storedPublicInfo.corporationId !== corporationId ||
			storedPublicInfo.ceoId !== publicInfo.ceoId ||
			storedPublicInfo.creatorId !== publicInfo.creatorId ||
			storedPublicInfo.name !== publicInfo.name ||
			storedPublicInfo.ticker !== publicInfo.ticker ||
			storedPublicInfo.memberCount !== publicInfo.memberCount ||
			storedPublicInfo.shares !== publicInfo.shares ||
			storedPublicInfo.taxRate !== publicInfo.taxRate ||
			storedPublicInfo.url !== publicInfo.url ||
			storedPublicInfo.allianceId !== publicInfo.allianceId ||
			storedPublicInfo.factionId !== publicInfo.factionId ||
			storedPublicInfo.warEligible !== publicInfo.warEligible ||
			(storedPublicInfo.dateFounded?.toISOString() ?? null) !==
				(publicInfo.dateFounded?.toISOString() ?? null) ||
			storedPublicInfo.description !== publicInfo.description ||
			storedPublicInfo.homeStationId !== publicInfo.homeStationId
		) {
			throw new Error(
				`Failed to persist corporation public info for corporation ID ${corporationId}`
			)
		}
	}

	/**
	 * Store sovereignty system snapshots (workflow-friendly)
	 */
	async storeSovereigntySystems(
		corporationId: string,
		systems: EsiSovereigntySystem[]
	): Promise<void> {
		const now = new Date()
		const universe = getStub<Universe>(this.env.UNIVERSE, 'default')
		const tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		const existingRows = await this.getDb().query.structureSovereigntySystems.findMany({
			where: eq(structureSovereigntySystems.corporationId, corporationId),
			columns: {
				systemId: true,
			},
		})
		const systemGeography: Awaited<ReturnType<Universe['resolveSolarSystemsByIds']>> =
			systems.length > 0
				? await withRpcResult(
						universe.resolveSolarSystemsByIds([
							...new Set(systems.map((system) => system.system_id)),
						]),
						cloneRpcRecord
					)
				: {}
		const regionIds = [
			...new Set(
				Object.values(systemGeography)
					.filter(
						(system): system is NonNullable<(typeof systemGeography)[string]> => system !== null
					)
					.map((system) => system.regionId)
					.filter((regionId): regionId is string => Boolean(regionId))
			),
		]
		const regionGeography: Awaited<ReturnType<Universe['resolveRegionsByIds']>> =
			regionIds.length > 0
				? await withRpcResult(universe.resolveRegionsByIds(regionIds), cloneRpcRecord)
				: {}
		const allianceNames = await resolveAllianceNames(
			tokenStore,
			systems.flatMap((system) => (system.alliance_id ? [system.alliance_id] : []))
		)
		const values = systems.map((system) => {
			const resolvedSystem = systemGeography[system.system_id] ?? null
			const resolvedRegion = resolvedSystem?.regionId
				? (regionGeography[resolvedSystem.regionId] ?? null)
				: null
			const claimedSince = parseDateOrNull(system.claimed_since) ?? null
			const vulnerabilityWindowStart = parseDateOrNull(system.vulnerability_window?.start) ?? null
			const vulnerabilityWindowEnd = parseDateOrNull(system.vulnerability_window?.end) ?? null
			const resolvedSystemName = resolvedSystem?.solarSystemName ?? system.system_name ?? null

			return {
				systemId: system.system_id,
				corporationId,
				systemName: resolvedSystemName,
				regionId: resolvedSystem?.regionId ?? null,
				regionName: resolvedRegion?.regionName ?? resolvedSystem?.regionId ?? null,
				claimType: system.claim_type,
				allianceId: system.alliance_id ?? null,
				allianceName: system.alliance_id ? (allianceNames.get(system.alliance_id) ?? null) : null,
				corporationClaimantId: system.corporation_id ?? null,
				factionId: system.faction_id ?? null,
				claimedSince,
				sovereigntyHubStructureId: system.sovereignty_hub_structure_id ?? null,
				isCapitalSystem: system.is_capital_system ?? null,
				vulnerabilityWindowStart,
				vulnerabilityWindowEnd,
				activityDefenseMultiplier:
					parseNumberOrNull(system.activity_defense_multiplier)?.toString() ?? null,
				militaryLevel: system.military_level ?? null,
				industrialLevel: system.industrial_level ?? null,
				strategicLevel: system.strategic_level ?? null,
				sourceSyncAt: now,
				lastSyncedAt: now,
				updatedAt: now,
			}
		})

		if (values.length === 0) {
			await this.getDb()
				.delete(structureSovereigntySystems)
				.where(eq(structureSovereigntySystems.corporationId, corporationId))
			return
		}

		const currentSystemIds = new Set(values.map((row) => row.systemId))
		const departedSystemIds = existingRows
			.map((row) => row.systemId)
			.filter((systemId) => !currentSystemIds.has(systemId))
		const BATCH_SIZE = STRUCTURE_SNAPSHOT_BATCH_SIZE
		for (let i = 0; i < values.length; i += BATCH_SIZE) {
			const batch = values.slice(i, i + BATCH_SIZE)
			await this.getDb()
				.insert(structureSovereigntySystems)
				.values(batch)
				.onConflictDoUpdate({
					target: structureSovereigntySystems.systemId,
					set: {
						corporationId: sql`excluded.corporation_id`,
						systemName: sql`excluded.system_name`,
						regionId: sql`excluded.region_id`,
						regionName: sql`excluded.region_name`,
						claimType: sql`excluded.claim_type`,
						allianceId: sql`excluded.alliance_id`,
						allianceName: sql`excluded.alliance_name`,
						corporationClaimantId: sql`excluded.corporation_claimant_id`,
						factionId: sql`excluded.faction_id`,
						claimedSince: sql`excluded.claimed_since`,
						sovereigntyHubStructureId: sql`excluded.sovereignty_hub_structure_id`,
						isCapitalSystem: sql`excluded.is_capital_system`,
						vulnerabilityWindowStart: sql`excluded.vulnerability_window_start`,
						vulnerabilityWindowEnd: sql`excluded.vulnerability_window_end`,
						activityDefenseMultiplier: sql`excluded.activity_defense_multiplier`,
						militaryLevel: sql`excluded.military_level`,
						industrialLevel: sql`excluded.industrial_level`,
						strategicLevel: sql`excluded.strategic_level`,
						sourceSyncAt: sql`excluded.source_sync_at`,
						lastSyncedAt: sql`excluded.last_synced_at`,
						updatedAt: sql`excluded.updated_at`,
					},
				})
		}

		await deleteIdsInBatches(departedSystemIds, STRUCTURE_CLEANUP_BATCH_SIZE, async (batch) => {
			await this.getDb()
				.delete(structureSovereigntySystems)
				.where(
					and(
						eq(structureSovereigntySystems.corporationId, corporationId),
						inArray(structureSovereigntySystems.systemId, batch)
					)
				)
		})
	}

	/**
	 * Store the shared sovereignty system snapshot used by workflow fan-out.
	 */
	async storeSharedSovereigntySystems(systems: EsiSovereigntySystem[]): Promise<void> {
		const observedAt = new Date().toISOString()
		const rowEntries = Object.fromEntries(
			systems.map((system) => [
				`${SHARED_SOVEREIGNTY_SYSTEMS_CACHE_ROW_PREFIX}${system.system_id}`,
				system,
			])
		)

		await this.state.storage.transaction(async (txn) => {
			const existing = await txn.list<EsiSovereigntySystem>({
				prefix: SHARED_SOVEREIGNTY_SYSTEMS_CACHE_ROW_PREFIX,
			})
			if (existing.size > 0) {
				await txn.delete([...existing.keys()])
			}
			await txn.put(SHARED_SOVEREIGNTY_SYSTEMS_CACHE_META_KEY, observedAt)
			await txn.put(SHARED_SOVEREIGNTY_SYSTEMS_CACHE_COUNT_KEY, systems.length)
			if (systems.length > 0) {
				await txn.put(rowEntries)
			}
		})
	}

	async acquireSharedSovereigntySystemsRefreshLease(
		leaseSeconds = SHARED_SOVEREIGNTY_SYSTEMS_REFRESH_LEASE_SECONDS
	): Promise<string | null> {
		const now = Date.now()
		const lease: SharedSovereigntySystemsRefreshLease = {
			token: crypto.randomUUID(),
			acquiredAtMs: now,
			expiresAtMs: now + leaseSeconds * 1000,
		}
		let acquired = false

		await this.state.storage.transaction(async (txn) => {
			const existing = await txn.get<SharedSovereigntySystemsRefreshLease>(
				SHARED_SOVEREIGNTY_SYSTEMS_REFRESH_LEASE_KEY
			)
			if (existing && existing.expiresAtMs > now) {
				return
			}

			await txn.put(SHARED_SOVEREIGNTY_SYSTEMS_REFRESH_LEASE_KEY, lease)
			acquired = true
		})

		return acquired ? lease.token : null
	}

	async releaseSharedSovereigntySystemsRefreshLease(leaseToken: string): Promise<void> {
		await this.state.storage.transaction(async (txn) => {
			const existing = await txn.get<SharedSovereigntySystemsRefreshLease>(
				SHARED_SOVEREIGNTY_SYSTEMS_REFRESH_LEASE_KEY
			)
			if (!existing || existing.token !== leaseToken) {
				return
			}
			await txn.delete(SHARED_SOVEREIGNTY_SYSTEMS_REFRESH_LEASE_KEY)
		})
	}

	async getSharedSovereigntySystemsForCorporation(
		corporationId: string,
		maxAgeSeconds = SHARED_SOVEREIGNTY_SYSTEMS_CACHE_MAX_AGE_SECONDS
	): Promise<EsiSovereigntySystem[] | null> {
		const observedAtRaw = await this.state.storage.get<string>(
			SHARED_SOVEREIGNTY_SYSTEMS_CACHE_META_KEY
		)
		const cachedSystemCount = await this.state.storage.get<number>(
			SHARED_SOVEREIGNTY_SYSTEMS_CACHE_COUNT_KEY
		)
		if (!observedAtRaw || cachedSystemCount === undefined) {
			return null
		}

		const observedAt = parseDateOrNull(observedAtRaw)
		if (!observedAt || Date.now() - observedAt.getTime() > maxAgeSeconds * 1000) {
			return null
		}

		const rows = await this.state.storage.list<EsiSovereigntySystem>({
			prefix: SHARED_SOVEREIGNTY_SYSTEMS_CACHE_ROW_PREFIX,
		})
		if (rows.size !== cachedSystemCount) {
			return null
		}
		return [...rows.values()].filter(
			(system) => system.claim_type === 'alliance' && system.corporation_id === corporationId
		)
	}

	async getSharedSovereigntySystemsSnapshot(
		maxAgeSeconds = SHARED_SOVEREIGNTY_SYSTEMS_CACHE_MAX_AGE_SECONDS
	): Promise<EsiSovereigntySystem[] | null> {
		const observedAtRaw = await this.state.storage.get<string>(
			SHARED_SOVEREIGNTY_SYSTEMS_CACHE_META_KEY
		)
		const cachedSystemCount = await this.state.storage.get<number>(
			SHARED_SOVEREIGNTY_SYSTEMS_CACHE_COUNT_KEY
		)
		if (!observedAtRaw || cachedSystemCount === undefined) {
			return null
		}

		const observedAt = parseDateOrNull(observedAtRaw)
		if (!observedAt) {
			return null
		}

		const ageMs = Date.now() - observedAt.getTime()
		if (ageMs > maxAgeSeconds * 1000) {
			return null
		}

		const rows = await this.state.storage.list<EsiSovereigntySystem>({
			prefix: SHARED_SOVEREIGNTY_SYSTEMS_CACHE_ROW_PREFIX,
		})
		if (rows.size !== cachedSystemCount) {
			return null
		}
		return [...rows.values()]
	}

	async hasFreshSharedSovereigntySystems(
		maxAgeSeconds = SHARED_SOVEREIGNTY_SYSTEMS_CACHE_MAX_AGE_SECONDS
	): Promise<boolean> {
		const observedAtRaw = await this.state.storage.get<string>(
			SHARED_SOVEREIGNTY_SYSTEMS_CACHE_META_KEY
		)
		const cachedSystemCount = await this.state.storage.get<number>(
			SHARED_SOVEREIGNTY_SYSTEMS_CACHE_COUNT_KEY
		)
		if (!observedAtRaw || cachedSystemCount === undefined) {
			return false
		}

		const observedAt = parseDateOrNull(observedAtRaw)
		if (!observedAt) {
			return false
		}

		return Date.now() - observedAt.getTime() <= maxAgeSeconds * 1000
	}

	/**
	 * Get a cached sovereignty system snapshot for a specific corporation if it is still within TTL.
	 */
	async getSovereigntySystems(
		corporationId: string,
		maxAgeSeconds = 300
	): Promise<EsiSovereigntySystem[] | null> {
		const rows = await this.getDb().query.structureSovereigntySystems.findMany({
			where: eq(structureSovereigntySystems.corporationId, corporationId),
		})

		if (rows.length === 0) {
			return null
		}

		const newestSyncAt = rows.reduce<Date | null>((latest, row) => {
			const candidate = row.lastSyncedAt ?? row.sourceSyncAt ?? null
			if (!candidate) return latest
			if (!latest || candidate.getTime() > latest.getTime()) {
				return candidate
			}
			return latest
		}, null)

		if (!newestSyncAt) {
			return null
		}

		const ageMs = Date.now() - newestSyncAt.getTime()
		if (ageMs > maxAgeSeconds * 1000) {
			return null
		}

		return rows.map((row) => ({
			system_id: row.systemId,
			system_name: row.systemName ?? null,
			claim_type: row.claimType as EsiSovereigntySystem['claim_type'],
			alliance_id: row.allianceId ?? null,
			corporation_id: row.corporationClaimantId ?? null,
			faction_id: row.factionId ?? null,
			claimed_since: row.claimedSince?.toISOString() ?? null,
			is_capital_system: row.isCapitalSystem ?? null,
			sovereignty_hub_structure_id: row.sovereigntyHubStructureId ?? null,
			vulnerability_window:
				row.vulnerabilityWindowStart !== null || row.vulnerabilityWindowEnd !== null
					? {
							start: row.vulnerabilityWindowStart?.toISOString() ?? '',
							end: row.vulnerabilityWindowEnd?.toISOString() ?? '',
						}
					: null,
			activity_defense_multiplier: row.activityDefenseMultiplier ?? null,
			military_level: row.militaryLevel ?? null,
			industrial_level: row.industrialLevel ?? null,
			strategic_level: row.strategicLevel ?? null,
		}))
	}

	/**
	 * Store sovereignty hub snapshots (workflow-friendly)
	 */
	async storeSovereigntyHubs(
		corporationId: string,
		hubs: EsiSovereigntyHub[],
		options: {
			pruneCandidateIds?: readonly string[]
		} = {}
	): Promise<void> {
		const now = new Date()
		const pruneCandidateIds = [
			...new Set((options.pruneCandidateIds ?? []).map((id) => String(id))),
		]
		const liveStructureIds = [...new Set(hubs.map((hub) => hub.structure_id))]
		const tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		const controllerAllianceNames = await resolveAllianceNames(
			tokenStore,
			hubs.flatMap((hub) => (hub.controller_alliance_id ? [hub.controller_alliance_id] : []))
		)
		const existingRows =
			liveStructureIds.length > 0
				? await this.getDb().query.structureSovereigntyHubs.findMany({
						where: and(
							eq(structureSovereigntyHubs.corporationId, corporationId),
							inArray(structureSovereigntyHubs.structureId, liveStructureIds)
						),
						columns: {
							structureId: true,
							systemId: true,
							systemName: true,
						},
					})
				: []
		const existingByStructureId = new Map(existingRows.map((row) => [row.structureId, row]))
		const newHubs = hubs.filter((hub) => !existingByStructureId.has(hub.structure_id))
		const universe = getStub<Universe>(this.env.UNIVERSE, 'default')
		const systemGeography: Awaited<ReturnType<Universe['resolveSolarSystemsByIds']>> =
			newHubs.length > 0
				? await withRpcResult(
						universe.resolveSolarSystemsByIds([...new Set(newHubs.map((hub) => hub.system_id))]),
						(result) => cloneRpcRecord(result ?? {})
					)
				: {}
		const values: SovereigntyHubInsertRow[] = hubs.map((hub) => {
			const existing = existingByStructureId.get(hub.structure_id)
			const resolvedSystemId = existing?.systemId ?? hub.system_id
			const resolvedSystemName =
				existing?.systemName ??
				systemGeography[hub.system_id]?.solarSystemName ??
				hub.system_name ??
				null
			const reagents = hub.reagent_bay.reagents.map((reagent) => ({
				typeId: reagent.type_id,
				typeName:
					reagent.type_id === SKYHOOK_MAGMATIC_GAS_TYPE_ID
						? SKYHOOK_MAGMATIC_GAS_TYPE_NAME
						: reagent.type_id === SKYHOOK_SUPERIONIC_ICE_TYPE_ID
							? SKYHOOK_SUPERIONIC_ICE_TYPE_NAME
							: null,
				amount: reagent.amount,
				burningPerHour: reagent.burning_per_hour,
				lastCycle: reagent.last_cycle,
			})) satisfies SovereigntyReagentEntry[]
			return {
				structureId: hub.structure_id,
				corporationId,
				systemId: resolvedSystemId,
				systemName: resolvedSystemName,
				typeId: hub.type_id,
				fuelAccessListId: hub.fuel_access_list_id ?? null,
				controllerAllianceId: hub.controller_alliance_id ?? null,
				controllerAllianceName: hub.controller_alliance_id
					? (controllerAllianceNames.get(hub.controller_alliance_id) ?? null)
					: null,
				reagentBayLastUpdated: parseDateOrNull(hub.reagent_bay.last_updated) ?? null,
				reagentBay: {
					lastUpdated: hub.reagent_bay.last_updated,
					summary: summarizeSovereigntyReagentBay(reagents),
					reagents,
				},
				resources: hub.resources,
				upgrades: hub.upgrades.map((upgrade) => ({
					typeId: upgrade.type_id,
					powerState: upgrade.power_state,
				})),
				vulnerabilityWindowStart: parseDateOrNull(hub.vulnerability_window?.start) ?? null,
				vulnerabilityWindowEnd: parseDateOrNull(hub.vulnerability_window?.end) ?? null,
				workforceTransport: normalizeSovereigntyWorkforceTransport(hub.workforce_transport),
				syncStatus: 'ok' as const,
				syncFailureReason: null,
				lastAttemptedSyncAt: now,
				sourceSyncAt: now,
				lastSyncedAt: now,
				updatedAt: now,
			}
		})

		const BATCH_SIZE = STRUCTURE_SNAPSHOT_BATCH_SIZE
		for (let i = 0; i < values.length; i += BATCH_SIZE) {
			const batch = values.slice(i, i + BATCH_SIZE)
			await this.getDb()
				.insert(structureSovereigntyHubs)
				.values(batch)
				.onConflictDoUpdate({
					target: structureSovereigntyHubs.structureId,
					set: {
						corporationId: sql`excluded.corporation_id`,
						fuelAccessListId: sql`excluded.fuel_access_list_id`,
						controllerAllianceId: sql`excluded.controller_alliance_id`,
						controllerAllianceName: sql`excluded.controller_alliance_name`,
						reagentBayLastUpdated: sql`excluded.reagent_bay_last_updated`,
						reagentBay: sql`excluded.reagent_bay`,
						resources: sql`excluded.resources`,
						upgrades: sql`excluded.upgrades`,
						vulnerabilityWindowStart: sql`excluded.vulnerability_window_start`,
						vulnerabilityWindowEnd: sql`excluded.vulnerability_window_end`,
						workforceTransport: sql`excluded.workforce_transport`,
						syncStatus: sql`excluded.sync_status`,
						syncFailureReason: sql`excluded.sync_failure_reason`,
						lastAttemptedSyncAt: sql`excluded.last_attempted_sync_at`,
						sourceSyncAt: sql`excluded.source_sync_at`,
						lastSyncedAt: sql`excluded.last_synced_at`,
						updatedAt: sql`excluded.updated_at`,
					},
				})
		}

		await deleteIdsInBatches(pruneCandidateIds, STRUCTURE_CLEANUP_BATCH_SIZE, async (batch) => {
			await this.getDb()
				.delete(structureSovereigntyHubs)
				.where(
					and(
						eq(structureSovereigntyHubs.corporationId, corporationId),
						inArray(structureSovereigntyHubs.structureId, batch)
					)
				)
		})
	}

	private async getTypeScopedStructureSyncPriorities(params: {
		corporationId: string
		targetTable: 'sovereignty' | 'skyhooks' | 'moon-drills' | 'mining-extractions'
		structureIds?: readonly string[]
	}): Promise<
		Array<{
			structureId: string
			lastAttemptedSyncAt: Date | null
			lastSyncedAt: Date | null
		}>
	> {
		const { corporationId, targetTable, structureIds } = params
		const liveStructureIds = structureIds
			? [...new Set(structureIds.map((structureId) => String(structureId)))]
			: null
		if (liveStructureIds?.length === 0) {
			return []
		}
		const now = new Date()
		const successCutoff = new Date(now.getTime() - 60 * 60 * 1000)
		const attemptCutoff = new Date(now.getTime() - 15 * 60 * 1000)
		const rows: Array<{
			structureId: string
			lastAttemptedSyncAt: Date | null
			lastSyncedAt: Date | null
		}> = []

		while (true) {
			const batch =
				targetTable === 'sovereignty'
					? await this.getDb().query.structureSovereigntyHubs.findMany({
							where: and(
								eq(structureSovereigntyHubs.corporationId, corporationId),
								...(liveStructureIds
									? [inArray(structureSovereigntyHubs.structureId, liveStructureIds)]
									: []),
								sql`(${structureSovereigntyHubs.lastSyncedAt} is null or ${structureSovereigntyHubs.lastSyncedAt} < ${successCutoff})`,
								sql`coalesce(${structureSovereigntyHubs.lastAttemptedSyncAt}, to_timestamp(0)) < ${attemptCutoff}`
							),
							orderBy: [
								asc(sql`coalesce(${structureSovereigntyHubs.lastSyncedAt}, to_timestamp(0))`),
								asc(
									sql`coalesce(${structureSovereigntyHubs.lastAttemptedSyncAt}, to_timestamp(0))`
								),
								asc(structureSovereigntyHubs.structureId),
							],
							columns: {
								structureId: true,
								lastAttemptedSyncAt: true,
								lastSyncedAt: true,
							},
							limit: STRUCTURE_ENRICHMENT_PRIORITY_LIMIT,
							offset: rows.length,
						})
					: targetTable === 'skyhooks'
						? await this.getDb().query.structureSkyhooks.findMany({
								where: and(
									eq(structureSkyhooks.corporationId, corporationId),
									...(liveStructureIds
										? [inArray(structureSkyhooks.structureId, liveStructureIds)]
										: []),
									sql`(${structureSkyhooks.lastSyncedAt} is null or ${structureSkyhooks.lastSyncedAt} < ${successCutoff})`,
									sql`coalesce(${structureSkyhooks.lastAttemptedSyncAt}, to_timestamp(0)) < ${attemptCutoff}`
								),
								orderBy: [
									asc(sql`coalesce(${structureSkyhooks.lastSyncedAt}, to_timestamp(0))`),
									asc(sql`coalesce(${structureSkyhooks.lastAttemptedSyncAt}, to_timestamp(0))`),
									asc(structureSkyhooks.structureId),
								],
								columns: {
									structureId: true,
									lastAttemptedSyncAt: true,
									lastSyncedAt: true,
								},
								limit: STRUCTURE_ENRICHMENT_PRIORITY_LIMIT,
								offset: rows.length,
							})
						: targetTable === 'moon-drills'
							? await this.getDb().query.structureMoonDrills.findMany({
									where: and(
										eq(structureMoonDrills.corporationId, corporationId),
										...(liveStructureIds
											? [inArray(structureMoonDrills.structureId, liveStructureIds)]
											: []),
										sql`(${structureMoonDrills.lastSyncedAt} is null or ${structureMoonDrills.lastSyncedAt} < ${successCutoff})`,
										sql`coalesce(${structureMoonDrills.lastAttemptedSyncAt}, to_timestamp(0)) < ${attemptCutoff}`
									),
									orderBy: [
										asc(sql`coalesce(${structureMoonDrills.lastSyncedAt}, to_timestamp(0))`),
										asc(sql`coalesce(${structureMoonDrills.lastAttemptedSyncAt}, to_timestamp(0))`),
										asc(structureMoonDrills.structureId),
									],
									columns: {
										structureId: true,
										lastAttemptedSyncAt: true,
										lastSyncedAt: true,
									},
									limit: STRUCTURE_ENRICHMENT_PRIORITY_LIMIT,
									offset: rows.length,
								})
							: await this.getDb().query.structureMiningExtractions.findMany({
									where: and(
										eq(structureMiningExtractions.corporationId, corporationId),
										...(liveStructureIds
											? [inArray(structureMiningExtractions.structureId, liveStructureIds)]
											: []),
										sql`(${structureMiningExtractions.lastSyncedAt} is null or ${structureMiningExtractions.lastSyncedAt} < ${successCutoff})`,
										sql`coalesce(${structureMiningExtractions.lastAttemptedSyncAt}, to_timestamp(0)) < ${attemptCutoff}`
									),
									orderBy: [
										asc(sql`coalesce(${structureMiningExtractions.lastSyncedAt}, to_timestamp(0))`),
										asc(
											sql`coalesce(${structureMiningExtractions.lastAttemptedSyncAt}, to_timestamp(0))`
										),
										asc(structureMiningExtractions.structureId),
									],
									columns: {
										structureId: true,
										lastAttemptedSyncAt: true,
										lastSyncedAt: true,
									},
									limit: STRUCTURE_ENRICHMENT_PRIORITY_LIMIT,
									offset: rows.length,
								})

			if (batch.length === 0) {
				break
			}

			rows.push(...batch)
		}

		return rows.map((row) => ({
			...row,
			lastAttemptedSyncAt: row.lastAttemptedSyncAt ?? null,
		}))
	}

	private async claimStructureSyncAttempts(params: {
		corporationId: string
		targetTable: 'sovereignty' | 'skyhooks' | 'moon-drills' | 'mining-extractions'
		structureIds: readonly string[]
	}): Promise<string[]> {
		const { corporationId, targetTable, structureIds } = params
		const uniqueStructureIds = [...new Set(structureIds.map((structureId) => String(structureId)))]
		if (uniqueStructureIds.length === 0) {
			return []
		}

		const now = new Date()
		const successCutoff = new Date(now.getTime() - 60 * 60 * 1000)
		const attemptCutoff = new Date(now.getTime() - 15 * 60 * 1000)
		if (targetTable === 'sovereignty') {
			const rows = await this.getDb()
				.update(structureSovereigntyHubs)
				.set({ lastAttemptedSyncAt: now })
				.where(
					and(
						eq(structureSovereigntyHubs.corporationId, corporationId),
						inArray(structureSovereigntyHubs.structureId, uniqueStructureIds),
						sql`(${structureSovereigntyHubs.lastSyncedAt} is null or ${structureSovereigntyHubs.lastSyncedAt} < ${successCutoff})`,
						sql`coalesce(${structureSovereigntyHubs.lastAttemptedSyncAt}, to_timestamp(0)) < ${attemptCutoff}`
					)
				)
				.returning({ structureId: structureSovereigntyHubs.structureId })
			return rows.map((row) => row.structureId)
		}

		if (targetTable === 'skyhooks') {
			const rows = await this.getDb()
				.update(structureSkyhooks)
				.set({ lastAttemptedSyncAt: now })
				.where(
					and(
						eq(structureSkyhooks.corporationId, corporationId),
						inArray(structureSkyhooks.structureId, uniqueStructureIds),
						sql`(${structureSkyhooks.lastSyncedAt} is null or ${structureSkyhooks.lastSyncedAt} < ${successCutoff})`,
						sql`coalesce(${structureSkyhooks.lastAttemptedSyncAt}, to_timestamp(0)) < ${attemptCutoff}`
					)
				)
				.returning({ structureId: structureSkyhooks.structureId })
			return rows.map((row) => row.structureId)
		}

		if (targetTable === 'moon-drills') {
			const rows = await this.getDb()
				.update(structureMoonDrills)
				.set({ lastAttemptedSyncAt: now })
				.where(
					and(
						eq(structureMoonDrills.corporationId, corporationId),
						inArray(structureMoonDrills.structureId, uniqueStructureIds),
						sql`(${structureMoonDrills.lastSyncedAt} is null or ${structureMoonDrills.lastSyncedAt} < ${successCutoff})`,
						sql`coalesce(${structureMoonDrills.lastAttemptedSyncAt}, to_timestamp(0)) < ${attemptCutoff}`
					)
				)
				.returning({ structureId: structureMoonDrills.structureId })
			return rows.map((row) => row.structureId)
		}

		const rows = await this.getDb()
			.update(structureMiningExtractions)
			.set({ lastAttemptedSyncAt: now })
			.where(
				and(
					eq(structureMiningExtractions.corporationId, corporationId),
					inArray(structureMiningExtractions.structureId, uniqueStructureIds),
					sql`(${structureMiningExtractions.lastSyncedAt} is null or ${structureMiningExtractions.lastSyncedAt} < ${successCutoff})`,
					sql`coalesce(${structureMiningExtractions.lastAttemptedSyncAt}, to_timestamp(0)) < ${attemptCutoff}`
				)
			)
			.returning({ structureId: structureMiningExtractions.structureId })
		return rows.map((row) => row.structureId)
	}

	private async getTypeScopedStructureIds(params: {
		corporationId: string
		targetTable: 'sovereignty' | 'skyhooks' | 'moon-drills' | 'mining-extractions'
		updatedBefore?: Date
	}): Promise<string[]> {
		const { corporationId, targetTable, updatedBefore } = params
		switch (targetTable) {
			case 'sovereignty':
				return (
					await this.getDb().query.structureSovereigntyHubs.findMany({
						where: updatedBefore
							? and(
									eq(structureSovereigntyHubs.corporationId, corporationId),
									sql`${structureSovereigntyHubs.updatedAt} < ${updatedBefore}`
								)
							: eq(structureSovereigntyHubs.corporationId, corporationId),
						columns: {
							structureId: true,
						},
					})
				).map((row) => row.structureId)
			case 'skyhooks':
				return (
					await this.getDb().query.structureSkyhooks.findMany({
						where: updatedBefore
							? and(
									eq(structureSkyhooks.corporationId, corporationId),
									sql`${structureSkyhooks.updatedAt} < ${updatedBefore}`
								)
							: eq(structureSkyhooks.corporationId, corporationId),
						columns: {
							structureId: true,
						},
					})
				).map((row) => row.structureId)
			case 'moon-drills':
				return (
					await this.getDb().query.structureMoonDrills.findMany({
						where: updatedBefore
							? and(
									eq(structureMoonDrills.corporationId, corporationId),
									sql`${structureMoonDrills.updatedAt} < ${updatedBefore}`
								)
							: eq(structureMoonDrills.corporationId, corporationId),
						columns: {
							structureId: true,
						},
					})
				).map((row) => row.structureId)
			case 'mining-extractions':
				return (
					await this.getDb().query.structureMiningExtractions.findMany({
						where: updatedBefore
							? and(
									eq(structureMiningExtractions.corporationId, corporationId),
									sql`${structureMiningExtractions.updatedAt} < ${updatedBefore}`
								)
							: eq(structureMiningExtractions.corporationId, corporationId),
						columns: {
							structureId: true,
						},
					})
				).map((row) => row.structureId)
		}
	}

	private async getTypeScopedMissingStructureIds(params: {
		corporationId: string
		targetTable: 'sovereignty' | 'skyhooks' | 'moon-drills' | 'mining-extractions'
		structureIds: string[]
	}): Promise<string[]> {
		const { corporationId, targetTable, structureIds } = params
		if (structureIds.length === 0) {
			return []
		}

		const liveStructureIds = [...new Set(structureIds.map((structureId) => String(structureId)))]
		const liveStructureRows = sql.join(
			liveStructureIds.map((structureId, index) => sql`(${structureId}, ${index})`),
			sql`, `
		)

		const targetTableRef =
			targetTable === 'sovereignty'
				? structureSovereigntyHubs
				: targetTable === 'skyhooks'
					? structureSkyhooks
					: targetTable === 'moon-drills'
						? structureMoonDrills
						: structureMiningExtractions

		const result = await this.getDb().execute<{ structureId: string }>(sql`
			with live_ids(structure_id, position) as (
				values ${liveStructureRows}
			)
			select live_ids.structure_id as "structureId"
			from live_ids
			left join ${targetTableRef}
				on ${targetTableRef.corporationId} = ${corporationId}
				and ${targetTableRef.structureId} = live_ids.structure_id
			where ${targetTableRef.structureId} is null
			order by live_ids.position asc
		`)

		return (result.rows ?? []).map((row) => row.structureId)
	}

	async getSovereigntyHubSyncPriorities(
		corporationId: string
	): Promise<SovereigntyHubSyncPriority[]> {
		return await this.getTypeScopedStructureSyncPriorities({
			corporationId,
			targetTable: 'sovereignty',
		})
	}

	async getMissingStructureIdsForPriorityQueue(
		corporationId: string,
		targetTable: StructureSyncPriorityTarget,
		structureIds: string[]
	): Promise<string[]> {
		return await this.getTypeScopedMissingStructureIds({
			corporationId,
			targetTable,
			structureIds,
		})
	}

	async getStructurePriorityQueue(
		corporationId: string,
		targetTable: StructureSyncPriorityTarget,
		structureIds: string[]
	): Promise<{
		newStructureIds: string[]
		pruneCandidateIds: string[]
		syncPriorities: Array<{
			structureId: string
			lastAttemptedSyncAt: Date | null
			lastSyncedAt: Date | null
		}>
	}> {
		const newStructureIds = await this.getTypeScopedMissingStructureIds({
			corporationId,
			targetTable,
			structureIds,
		})
		const pruneCandidateIds = await this.getStructureIdsMissingFromLiveListing(
			corporationId,
			targetTable,
			structureIds
		)
		const syncPriorities = await this.getTypeScopedStructureSyncPriorities({
			corporationId,
			targetTable,
			structureIds,
		})
		const claimedStructureIds = new Set(
			await this.claimStructureSyncAttempts({
				corporationId,
				targetTable,
				structureIds: syncPriorities.map((priority) => priority.structureId),
			})
		)

		return {
			newStructureIds,
			pruneCandidateIds,
			syncPriorities: syncPriorities.filter((priority) =>
				claimedStructureIds.has(priority.structureId)
			),
		}
	}

	async getStructureIdsMissingFromLiveListing(
		corporationId: string,
		targetTable: StructureSyncPriorityTarget,
		structureIds: string[]
	): Promise<string[]> {
		const liveStructureIds = [...new Set(structureIds.map((structureId) => String(structureId)))]
		const pruneBefore = new Date(Date.now() - STRUCTURE_PRUNE_GRACE_MS)
		const targetTableRef =
			targetTable === 'sovereignty'
				? structureSovereigntyHubs
				: targetTable === 'skyhooks'
					? structureSkyhooks
					: targetTable === 'moon-drills'
						? structureMoonDrills
						: structureMiningExtractions

		if (liveStructureIds.length === 0) {
			return await this.getTypeScopedStructureIds({
				corporationId,
				targetTable,
				updatedBefore: pruneBefore,
			})
		}

		const liveStructureRows = sql.join(
			liveStructureIds.map((structureId) => sql`(${structureId})`),
			sql`, `
		)
		const result = await this.getDb().execute<{ structureId: string }>(sql`
			with live_ids(structure_id) as (
				values ${liveStructureRows}
			)
			select ${targetTableRef.structureId} as "structureId"
			from ${targetTableRef}
			where ${targetTableRef.corporationId} = ${corporationId}
				and ${targetTableRef.updatedAt} < ${pruneBefore}
				and not exists (
					select 1
					from live_ids
					where live_ids.structure_id = ${targetTableRef.structureId}
				)
			order by ${targetTableRef.structureId} asc
		`)

		return (result.rows ?? []).map((row) => row.structureId)
	}

	async getSovereigntyHubStructureIds(corporationId: string): Promise<string[]> {
		return await this.getTypeScopedStructureIds({
			corporationId,
			targetTable: 'sovereignty',
		})
	}

	async getMoonDrillSyncPriorities(corporationId: string): Promise<MoonDrillSyncPriority[]> {
		return await this.getTypeScopedStructureSyncPriorities({
			corporationId,
			targetTable: 'moon-drills',
		})
	}

	async getMoonDrillStructureIds(corporationId: string): Promise<string[]> {
		return await this.getTypeScopedStructureIds({
			corporationId,
			targetTable: 'moon-drills',
		})
	}

	async getMiningCitadelSyncPriorities(
		corporationId: string
	): Promise<MiningCitadelSyncPriority[]> {
		return await this.getTypeScopedStructureSyncPriorities({
			corporationId,
			targetTable: 'mining-extractions',
		})
	}

	async getMiningCitadelStructureIds(corporationId: string): Promise<string[]> {
		return await this.getTypeScopedStructureIds({
			corporationId,
			targetTable: 'mining-extractions',
		})
	}

	async getSkyhookSyncPriorities(corporationId: string): Promise<SkyhookSyncPriority[]> {
		return await this.getTypeScopedStructureSyncPriorities({
			corporationId,
			targetTable: 'skyhooks',
		})
	}

	async getSkyhookStructureIds(corporationId: string): Promise<string[]> {
		return await this.getTypeScopedStructureIds({
			corporationId,
			targetTable: 'skyhooks',
		})
	}

	async markStructureEnrichmentSyncFailure(
		corporationId: string,
		target: 'sovereignty-hubs' | 'skyhooks',
		failureReason: string
	): Promise<void> {
		const mappedTarget: StructureSyncFailureTarget =
			target === 'sovereignty-hubs' ? 'sovereignty' : 'skyhooks'
		await this.markStructureSyncFailureReason(corporationId, mappedTarget, failureReason)
	}

	async markStructureEnrichmentFailures(
		corporationId: string,
		target: 'sovereignty-hubs' | 'skyhooks',
		failures: Array<{ structureId: string; failureReason: string }>
	): Promise<void> {
		const uniqueFailures = [
			...new Map(
				failures.map((failure) => [String(failure.structureId), failure] as const)
			).values(),
		]
		const now = new Date()

		for (let index = 0; index < uniqueFailures.length; index += STRUCTURE_CLEANUP_BATCH_SIZE) {
			const batch = uniqueFailures.slice(index, index + STRUCTURE_CLEANUP_BATCH_SIZE)
			const failureCases = sql.join(
				batch.map(
					({ structureId, failureReason }) => sql`when ${String(structureId)} then ${failureReason}`
				),
				sql` `
			)
			const structureIds = batch.map(({ structureId }) => String(structureId))

			if (target === 'sovereignty-hubs') {
				await this.getDb()
					.update(structureSovereigntyHubs)
					.set({
						syncStatus: 'warning',
						syncFailureReason: sql<string>`case ${structureSovereigntyHubs.structureId} ${failureCases} else ${structureSovereigntyHubs.syncFailureReason} end`,
						lastAttemptedSyncAt: now,
						updatedAt: now,
					})
					.where(
						and(
							eq(structureSovereigntyHubs.corporationId, corporationId),
							inArray(structureSovereigntyHubs.structureId, structureIds)
						)
					)
				continue
			}

			await this.getDb()
				.update(structureSkyhooks)
				.set({
					syncStatus: 'warning',
					syncFailureReason: sql<string>`case ${structureSkyhooks.structureId} ${failureCases} else ${structureSkyhooks.syncFailureReason} end`,
					lastAttemptedSyncAt: now,
					updatedAt: now,
				})
				.where(
					and(
						eq(structureSkyhooks.corporationId, corporationId),
						inArray(structureSkyhooks.structureId, structureIds)
					)
				)
		}
	}

	async markStructureSyncFailureReason(
		corporationId: string,
		target: StructureSyncFailureTarget,
		failureReason: string
	): Promise<void> {
		const update = async (tableName: StructureSyncFailureTarget): Promise<void> => {
			switch (tableName) {
				case 'structures':
					await this.getDb()
						.update(corporationStructures)
						.set({ syncFailureReason: failureReason })
						.where(eq(corporationStructures.corporationId, corporationId))
					return
				case 'sovereignty':
					await this.getDb()
						.update(structureSovereigntyHubs)
						.set({ syncFailureReason: failureReason })
						.where(eq(structureSovereigntyHubs.corporationId, corporationId))
					return
				case 'skyhooks':
					await this.getDb()
						.update(structureSkyhooks)
						.set({ syncFailureReason: failureReason })
						.where(eq(structureSkyhooks.corporationId, corporationId))
					return
				case 'moon-drills':
					await this.getDb()
						.update(structureMoonDrills)
						.set({ syncFailureReason: failureReason })
						.where(eq(structureMoonDrills.corporationId, corporationId))
					return
				case 'mining-extractions':
					await this.getDb()
						.update(structureMiningExtractions)
						.set({ syncFailureReason: failureReason })
						.where(eq(structureMiningExtractions.corporationId, corporationId))
					return
			}
		}

		await update(target)
	}

	/**
	 * Store skyhook snapshots (workflow-friendly)
	 */
	async storeSkyhooks(
		corporationId: string,
		skyhooks: EsiCorporationSkyhook[],
		options: {
			pruneCandidateIds?: readonly string[]
		} = {}
	): Promise<SkyhookStoreResult> {
		const now = new Date()
		const pruneCandidateIds = [
			...new Set((options.pruneCandidateIds ?? []).map((id) => String(id))),
		]
		const liveStructureIds = [...new Set(skyhooks.map((skyhook) => skyhook.structure_id))]
		const universe = getStub<Universe>(this.env.UNIVERSE, 'default')
		const existingRows =
			liveStructureIds.length > 0
				? await this.getDb().query.structureSkyhooks.findMany({
						where: and(
							eq(structureSkyhooks.corporationId, corporationId),
							inArray(structureSkyhooks.structureId, liveStructureIds)
						),
						columns: {
							structureId: true,
							planetName: true,
							systemName: true,
							updatedAt: true,
						},
					})
				: []
		const existingByStructureId = new Map(existingRows.map((row) => [row.structureId, row]))
		const existingBaseStructures =
			liveStructureIds.length > 0
				? await this.getDb().query.corporationStructures.findMany({
						where: and(
							eq(corporationStructures.corporationId, corporationId),
							eq(corporationStructures.typeId, ORBITAL_SKYHOOK_TYPE_ID),
							inArray(corporationStructures.structureId, liveStructureIds)
						),
						columns: {
							structureId: true,
							corporationId: true,
							typeId: true,
							systemId: true,
							systemName: true,
							regionId: true,
							regionName: true,
							updatedAt: true,
						},
					})
				: []
		const baseStructureById = new Map(existingBaseStructures.map((row) => [row.structureId, row]))
		const newSkyhooks = skyhooks.filter((skyhook) => !baseStructureById.has(skyhook.structure_id))
		const planetGeography: Awaited<ReturnType<Universe['resolvePlanetGeographyByIds']>> =
			newSkyhooks.length > 0
				? await withRpcResult(
						universe.resolvePlanetGeographyByIds([
							...new Set(newSkyhooks.map((skyhook) => skyhook.planet_id)),
						]),
						cloneRpcRecord
					)
				: {}
		const resolvedPlanetGeographies = Object.values(planetGeography).filter(
			(planet): planet is UniversePlanetGeography => planet !== null
		)
		const systemIds = [...new Set(resolvedPlanetGeographies.map((planet) => planet.solarSystemId))]
		const systemGeography: Awaited<ReturnType<Universe['resolveSolarSystemsByIds']>> =
			systemIds.length > 0
				? await withRpcResult(universe.resolveSolarSystemsByIds(systemIds), cloneRpcRecord)
				: {}
		const regionIds = [
			...new Set(
				Object.values(systemGeography)
					.filter((system): system is UniverseSolarSystem => system !== null)
					.map((system) => system.regionId)
					.filter((regionId): regionId is string => Boolean(regionId))
			),
		]
		const regionGeography: Awaited<ReturnType<Universe['resolveRegionsByIds']>> =
			regionIds.length > 0
				? await withRpcResult(universe.resolveRegionsByIds(regionIds), cloneRpcRecord)
				: {}

		const synthesizedRows = skyhooks
			.map((skyhook) => {
				const existingBaseStructure = baseStructureById.get(skyhook.structure_id) ?? null
				const existing = existingByStructureId.get(skyhook.structure_id) ?? null
				const isNewSkyhook = existingBaseStructure === null
				const resolvedPlanet = isNewSkyhook ? (planetGeography[skyhook.planet_id] ?? null) : null
				const resolvedSystem = resolvedPlanet?.solarSystemId
					? (systemGeography[resolvedPlanet.solarSystemId] ?? null)
					: null
				const resolvedRegion = resolvedSystem?.regionId
					? (regionGeography[resolvedSystem.regionId] ?? null)
					: null
				const baseStructure = buildSkyhookBaseStructureRow({
					corporationId,
					skyhook,
					planet: resolvedPlanet,
					system: resolvedSystem,
					region: resolvedRegion,
					existingRow: existingBaseStructure
						? {
								systemId: existingBaseStructure.systemId,
								systemName: existingBaseStructure.systemName,
								regionId: existingBaseStructure.regionId,
								regionName: existingBaseStructure.regionName,
								updatedAt: existingBaseStructure.updatedAt,
							}
						: null,
					observedAt: now,
				})
				if (!baseStructure) {
					logger.warn(
						'[storeSkyhooks] Skipping skyhook without resolvable base structure geography',
						{
							corporationId,
							structureId: skyhook.structure_id,
							planetId: skyhook.planet_id,
						}
					)
					return null
				}
				const storageRowData = buildSkyhookStorageRow({
					corporationId,
					skyhook,
					baseStructure,
					existingRow: existing
						? {
								planetName: existing.planetName,
								systemName: existing.systemName,
							}
						: null,
					planet: resolvedPlanet
						? {
								planetId: resolvedPlanet.planetId,
								planetName: resolvedPlanet.planetName,
								solarSystemName: resolvedPlanet.solarSystemName,
							}
						: null,
					observedAt: now,
				})
				if (!storageRowData) {
					return null
				}

				const storageRow: SkyhookInsertRow = {
					...storageRowData,
					syncStatus: 'ok' as const,
					syncFailureReason: null,
					updatedAt: now,
				}
				const reagentStorageRow = buildSkyhookReagentStorageRow({
					corporationId,
					skyhook,
					observedAt: now,
				})

				return {
					baseStructure,
					storageRow,
					reagentStorageRow,
				}
			})
			.filter(
				(
					row
				): row is {
					baseStructure: SkyhookBaseStructureRow
					storageRow: SkyhookInsertRow
					reagentStorageRow: SkyhookReagentStorageInsertRow
				} => row !== null
			)

		if (synthesizedRows.length === 0) {
			if (skyhooks.length > 0) {
				logger.warn(
					'[storeSkyhooks] Preserving existing skyhook snapshot because synthesis failed',
					{
						corporationId,
						skyhookCount: skyhooks.length,
					}
				)
				return { prunedCount: 0 }
			}
			const prunableStateIds = pruneCandidateIds
			const prunableBaseStructureIds = pruneCandidateIds

			await deleteIdsInBatches(prunableStateIds, STRUCTURE_CLEANUP_BATCH_SIZE, async (batch) => {
				await this.getDb()
					.delete(structureSkyhooks)
					.where(
						and(
							eq(structureSkyhooks.corporationId, corporationId),
							inArray(structureSkyhooks.structureId, batch)
						)
					)
			})
			await deleteIdsInBatches(
				prunableBaseStructureIds,
				STRUCTURE_CLEANUP_BATCH_SIZE,
				async (batch) => {
					await this.getDb()
						.delete(corporationStructures)
						.where(
							and(
								eq(corporationStructures.corporationId, corporationId),
								inArray(corporationStructures.structureId, batch)
							)
						)
				}
			)
			return { prunedCount: prunableStateIds.length + prunableBaseStructureIds.length }
		}

		const baseValues = synthesizedRows.map((row) => row.baseStructure)
		const values = synthesizedRows.map((row) => row.storageRow)
		const reagentValues = synthesizedRows.map((row) => row.reagentStorageRow)

		const departedBaseStructureIds = pruneCandidateIds
		const departedStateIds = pruneCandidateIds
		const BASE_BATCH_SIZE = STRUCTURE_SNAPSHOT_BATCH_SIZE
		for (let i = 0; i < baseValues.length; i += BASE_BATCH_SIZE) {
			const batch = baseValues.slice(i, i + BASE_BATCH_SIZE)
			await this.getDb()
				.insert(corporationStructures)
				.values(batch)
				.onConflictDoUpdate({
					target: corporationStructures.structureId,
					set: {
						corporationId: sql`excluded.corporation_id`,
						state: sql`excluded.state`,
						stateTimerEnd: sql`excluded.state_timer_end`,
						syncStatus: sql`excluded.sync_status`,
						syncFailureReason: sql`excluded.sync_failure_reason`,
						lastSyncedAt: sql`excluded.last_synced_at`,
						updatedAt: sql`excluded.updated_at`,
					},
				})
		}
		await deleteIdsInBatches(
			departedBaseStructureIds,
			STRUCTURE_CLEANUP_BATCH_SIZE,
			async (batch) => {
				await this.getDb()
					.delete(corporationStructures)
					.where(
						and(
							eq(corporationStructures.corporationId, corporationId),
							inArray(corporationStructures.structureId, batch)
						)
					)
			}
		)
		const STATE_BATCH_SIZE = STRUCTURE_SNAPSHOT_BATCH_SIZE
		for (let i = 0; i < values.length; i += STATE_BATCH_SIZE) {
			const batch = values.slice(i, i + STATE_BATCH_SIZE)
			await this.getDb()
				.insert(structureSkyhooks)
				.values(batch)
				.onConflictDoUpdate({
					target: structureSkyhooks.structureId,
					set: {
						corporationId: sql`excluded.corporation_id`,
						state: sql`excluded.state`,
						isActive: sql`excluded.is_active`,
						effectiveWorkforce: sql`excluded.effective_workforce`,
						reinforcementTimerEnd: sql`excluded.reinforcement_timer_end`,
						theftVulnerabilityStart: sql`excluded.theft_vulnerability_start`,
						theftVulnerabilityEnd: sql`excluded.theft_vulnerability_end`,
						syncStatus: sql`excluded.sync_status`,
						syncFailureReason: sql`excluded.sync_failure_reason`,
						lastAttemptedSyncAt: sql`excluded.last_attempted_sync_at`,
						lastObservedAt: sql`excluded.last_observed_at`,
						sourceSyncAt: sql`excluded.source_sync_at`,
						lastSyncedAt: sql`excluded.last_synced_at`,
						updatedAt: sql`excluded.updated_at`,
					},
				})
		}
		for (let i = 0; i < reagentValues.length; i += STATE_BATCH_SIZE) {
			const batch = reagentValues.slice(i, i + STATE_BATCH_SIZE)
			await this.getDb()
				.insert(structureSkyhookReagents)
				.values(batch)
				.onConflictDoUpdate({
					target: structureSkyhookReagents.structureId,
					set: {
						corporationId: sql`excluded.corporation_id`,
						magmaticGasSecuredStock: sql`excluded.magmatic_gas_secured_stock`,
						magmaticGasUnsecuredStock: sql`excluded.magmatic_gas_unsecured_stock`,
						magmaticGasLastCycle: sql`excluded.magmatic_gas_last_cycle`,
						superionicIceSecuredStock: sql`excluded.superionic_ice_secured_stock`,
						superionicIceUnsecuredStock: sql`excluded.superionic_ice_unsecured_stock`,
						superionicIceLastCycle: sql`excluded.superionic_ice_last_cycle`,
						updatedAt: sql`excluded.updated_at`,
					},
				})
		}

		await deleteIdsInBatches(departedStateIds, STRUCTURE_CLEANUP_BATCH_SIZE, async (batch) => {
			await this.getDb()
				.delete(structureSkyhooks)
				.where(
					and(
						eq(structureSkyhooks.corporationId, corporationId),
						inArray(structureSkyhooks.structureId, batch)
					)
				)
			await this.getDb()
				.delete(structureSkyhookReagents)
				.where(
					and(
						eq(structureSkyhookReagents.corporationId, corporationId),
						inArray(structureSkyhookReagents.structureId, batch)
					)
				)
		})

		return { prunedCount: departedStateIds.length }
	}

	/**
	 * Store mining extraction snapshots (workflow-friendly)
	 */
	async storeMiningExtractions(
		corporationId: string,
		miningExtractions: EsiCorporationMiningExtraction[],
		options: {
			pruneCandidateIds?: readonly string[]
		} = {}
	): Promise<void> {
		const now = new Date()
		const hasExplicitPruneCandidates = options.pruneCandidateIds !== undefined
		const existingRows = hasExplicitPruneCandidates
			? []
			: await this.getDb().query.structureMiningExtractions.findMany({
					where: eq(structureMiningExtractions.corporationId, corporationId),
					columns: {
						structureId: true,
						updatedAt: true,
					},
				})

		const values = miningExtractions.map((extraction) => {
			return {
				structureId: extraction.structure_id,
				corporationId,
				extractionStartTime: parseDateOrNull(extraction.extraction_start_time) ?? null,
				chunkArrivalTime: parseDateOrNull(extraction.chunk_arrival_time) ?? null,
				naturalDecayTime: parseDateOrNull(extraction.natural_decay_time) ?? null,
				sourceSyncAt: now,
				lastAttemptedSyncAt: now,
				lastSyncedAt: now,
				syncFailureReason: null,
				updatedAt: now,
			}
		})

		const currentStructureIds = new Set(values.map((row) => row.structureId))
		const departedStructureIds = hasExplicitPruneCandidates
			? [...new Set(options.pruneCandidateIds?.map((structureId) => String(structureId)) ?? [])]
			: filterPrunableStructureIds(existingRows, currentStructureIds, now)
		const BATCH_SIZE = STRUCTURE_SNAPSHOT_BATCH_SIZE
		for (let i = 0; i < values.length; i += BATCH_SIZE) {
			const batch = values.slice(i, i + BATCH_SIZE)
			await this.getDb()
				.insert(structureMiningExtractions)
				.values(batch)
				.onConflictDoUpdate({
					target: structureMiningExtractions.structureId,
					set: {
						corporationId: sql`excluded.corporation_id`,
						extractionStartTime: sql`excluded.extraction_start_time`,
						chunkArrivalTime: sql`excluded.chunk_arrival_time`,
						naturalDecayTime: sql`excluded.natural_decay_time`,
						lastAttemptedSyncAt: sql`excluded.last_attempted_sync_at`,
						sourceSyncAt: sql`excluded.source_sync_at`,
						lastSyncedAt: sql`excluded.last_synced_at`,
						syncFailureReason: sql`excluded.sync_failure_reason`,
						updatedAt: sql`excluded.updated_at`,
					},
				})
		}

		await deleteIdsInBatches(departedStructureIds, STRUCTURE_CLEANUP_BATCH_SIZE, async (batch) => {
			await this.getDb()
				.delete(structureMiningExtractions)
				.where(
					and(
						eq(structureMiningExtractions.corporationId, corporationId),
						inArray(structureMiningExtractions.structureId, batch)
					)
				)
		})
	}

	/**
	 * Fetch and store corporation members
	 */
	private async fetchAndStoreMembers(corporationId: string, _forceRefresh = false): Promise<void> {
		const { characterId } = await this.getConfiguredCharacter(corporationId)
		const tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')

		const memberIds: EsiCorporationMembers = await esiFetch.fetchMembers(
			tokenStore,
			corporationId,
			characterId
		)

		// Fetch existing members from database to identify departed members
		const existingMembers = await this.getDb()
			.select({ characterId: corporationMembers.characterId })
			.from(corporationMembers)
			.where(eq(corporationMembers.corporationId, corporationId))

		const existingMemberIds = new Set(existingMembers.map((m) => m.characterId))
		const currentMemberIds = new Set(memberIds)

		// Identify departed members (in database but not in current ESI response)
		const departedMemberIds = existingMembers
			.filter((m) => !currentMemberIds.has(m.characterId))
			.map((m) => m.characterId)

		try {
			// Remove departed members (those in database but not in current ESI response)
			if (departedMemberIds.length > 0) {
				await this.getDb()
					.delete(corporationMembers)
					.where(
						and(
							eq(corporationMembers.corporationId, corporationId),
							inArray(corporationMembers.characterId, departedMemberIds)
						)
					)

				logger.info('[fetchAndStoreMembers] Removed departed members:', {
					corporationId,
					count: departedMemberIds.length,
					characterIds: departedMemberIds,
				})

				// Also remove from corporationMemberTracking table
				await this.getDb()
					.delete(corporationMemberTracking)
					.where(
						and(
							eq(corporationMemberTracking.corporationId, corporationId),
							inArray(corporationMemberTracking.characterId, departedMemberIds)
						)
					)

				// Send messages to HR service to clean up roles for departed members
				const hrQueue = this.env['hr-member-departed']
				const messages = departedMemberIds.map((characterId) => ({
					body: {
						corporationId,
						characterId,
					},
				}))

				await hrQueue.sendBatch(messages)
				logger.debug('[fetchAndStoreMembers] Sent HR cleanup messages:', {
					corporationId,
					count: messages.length,
				})
			}

			// Upsert current members in batch to improve performance
			if (memberIds.length > 0) {
				const values = memberIds.map((memberId) => ({
					corporationId: String(corporationId),
					characterId: memberId,
				}))

				await this.getDb()
					.insert(corporationMembers)
					.values(values)
					.onConflictDoUpdate({
						target: [corporationMembers.corporationId, corporationMembers.characterId],
						set: {
							updatedAt: sql`CURRENT_TIMESTAMP`,
						},
					})
			}

			// Invalidate members cache after successful update
			await this.invalidateMembersCache(corporationId)

			// Log summary of changes
			const addedCount = memberIds.filter((id) => !existingMemberIds.has(id)).length
			if (addedCount > 0 || departedMemberIds.length > 0) {
				logger.debug('[fetchAndStoreMembers] Member sync completed:', {
					corporationId,
					added: addedCount,
					removed: departedMemberIds.length,
					total: memberIds.length,
				})
			}
		} catch (error) {
			logger.error('[fetchAndStoreMembers] Database operation failed:', {
				error,
				errorMessage: error instanceof Error ? error.message : String(error),
				errorStack: error instanceof Error ? error.stack : undefined,
				errorName: error instanceof Error ? error.name : undefined,
				errorCause: error instanceof Error ? error.cause : undefined,
				corporationId: String(corporationId),
				memberCount: memberIds.length,
				departedCount: departedMemberIds.length,
			})
			throw error
		}
	}

	/**
	 * Fetch and store member tracking data
	 */
	private async fetchAndStoreMemberTracking(
		corporationId: string,
		_forceRefresh = false
	): Promise<void> {
		const { characterId } = await this.getConfiguredCharacter(corporationId)
		await this.requireCorpRole(corporationId, characterId, ['Director'])

		const tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		const trackingData: EsiCorporationMemberTracking[] = await esiFetch.fetchMemberTracking(
			tokenStore,
			corporationId,
			characterId
		)

		// Fetch existing tracking records to identify departed members
		const existingTracking = await this.getDb()
			.select({ characterId: corporationMemberTracking.characterId })
			.from(corporationMemberTracking)
			.where(eq(corporationMemberTracking.corporationId, corporationId))

		const currentTrackingIds = new Set(trackingData.map((m) => m.character_id))

		// Identify departed members (in database but not in current ESI response)
		const departedMemberIds = existingTracking
			.filter((m) => !currentTrackingIds.has(m.characterId))
			.map((m) => m.characterId)

		// Remove departed members from tracking table
		if (departedMemberIds.length > 0) {
			await this.getDb()
				.delete(corporationMemberTracking)
				.where(
					and(
						eq(corporationMemberTracking.corporationId, corporationId),
						inArray(corporationMemberTracking.characterId, departedMemberIds)
					)
				)

			logger.debug('[fetchAndStoreMemberTracking] Removed departed members:', {
				corporationId,
				count: departedMemberIds.length,
				characterIds: departedMemberIds,
			})
		}

		// Update tracking data for current members in batch
		if (trackingData.length > 0) {
			const values = trackingData.map((member) => ({
				corporationId: String(corporationId),
				characterId: member.character_id,
				baseId: member.base_id || null,
				locationId: member.location_id || null,
				logoffDate: member.logoff_date ? new Date(member.logoff_date) : null,
				logonDate: member.logon_date ? new Date(member.logon_date) : null,
				shipTypeId: member.ship_type_id || null,
				startDate: member.start_date ? new Date(member.start_date) : null,
				updatedAt: new Date(),
			}))

			await this.getDb()
				.insert(corporationMemberTracking)
				.values(values)
				.onConflictDoUpdate({
					target: [corporationMemberTracking.corporationId, corporationMemberTracking.characterId],
					set: {
						baseId: sql`excluded.base_id`,
						locationId: sql`excluded.location_id`,
						logoffDate: sql`excluded.logoff_date`,
						logonDate: sql`excluded.logon_date`,
						shipTypeId: sql`excluded.ship_type_id`,
						startDate: sql`excluded.start_date`,
						updatedAt: sql`excluded.updated_at`,
					},
				})
		}
	}

	/**
	 * Fetch and store corporation wallets
	 */
	private async fetchAndStoreWallets(corporationId: string, _forceRefresh = false): Promise<void> {
		const { characterId } = await this.getConfiguredCharacter(corporationId)
		await this.requireCorpRole(corporationId, characterId, ['Accountant', 'Junior_Accountant'])

		const tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		const wallets = await esiFetch.fetchWallets(tokenStore, corporationId, characterId)

		if (wallets.length > 0) {
			const values = wallets.map((wallet) => ({
				corporationId: String(corporationId),
				division: wallet.division,
				balance: wallet.balance,
				updatedAt: new Date(),
			}))

			await this.getDb()
				.insert(corporationWallets)
				.values(values)
				.onConflictDoUpdate({
					target: [corporationWallets.corporationId, corporationWallets.division],
					set: {
						balance: sql`excluded.balance`,
						updatedAt: sql`excluded.updated_at`,
					},
				})
		}
	}

	/**
	 * Fetch and store wallet journal for a division
	 */
	private async fetchAndStoreWalletJournal(
		corporationId: string,
		division: number,
		_forceRefresh = false
	): Promise<void> {
		logger
			.withTags({
				corporationId,
				division,
				operation: 'fetch_wallet_journal',
			})
			.debug('Starting wallet journal fetch')

		const { characterId } = await this.getConfiguredCharacter(corporationId)
		await this.requireCorpRole(corporationId, characterId, ['Accountant', 'Junior_Accountant'])

		const tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		const entries = await esiFetch.fetchWalletJournal(
			tokenStore,
			corporationId,
			division,
			characterId
		)

		logger
			.withTags({
				corporationId,
				division,
				operation: 'fetch_wallet_journal',
			})
			.debug('Fetched wallet journal from ESI', {
				totalEntries: entries.length,
			})

		logger
			.withTags({
				corporationId,
				division,
				operation: 'fetch_wallet_journal',
			})
			.debug('Starting database insertion', {
				entriesToInsert: entries.length,
			})

		let persistedNewRows = 0
		try {
			persistedNewRows = (await this.storeWalletJournal(corporationId, division, entries))
				.persistedNewRows
		} catch (error) {
			logger
				.withTags({
					corporationId,
					division,
					operation: 'fetch_wallet_journal',
				})
				.error('Failed to insert journal entries', {
					entriesPersisted: persistedNewRows,
					totalEntries: entries.length,
					...toErrorLogDetails(error),
				})

			// Clear cache for this division so next attempt fetches fresh data
			const path = `/corporations/${corporationId}/wallets/${division}/journal`
			try {
				await tokenStore.clearEsiCache(path, characterId)
				logger
					.withTags({
						corporationId,
						division,
						operation: 'fetch_wallet_journal',
					})
					.debug('Cleared ESI cache after error', { path })
			} catch (clearError) {
				logger
					.withTags({
						corporationId,
						division,
						operation: 'fetch_wallet_journal',
					})
					.error('Failed to clear cache', {
						...toErrorLogDetails(clearError),
					})
			}

			throw error
		}

		logger
			.withTags({
				corporationId,
				division,
				operation: 'fetch_wallet_journal',
			})
			.debug('Completed wallet journal fetch and store', {
				totalInserted: persistedNewRows,
				totalEntries: entries.length,
			})
	}

	/**
	 * Fetch and store wallet transactions for a division
	 */
	private async fetchAndStoreWalletTransactions(
		corporationId: string,
		division: number,
		_forceRefresh = false
	): Promise<void> {
		logger
			.withTags({
				corporationId,
				division,
				operation: 'fetch_wallet_transactions',
			})
			.debug('Starting wallet transactions fetch')

		const { characterId } = await this.getConfiguredCharacter(corporationId)
		await this.requireCorpRole(corporationId, characterId, ['Accountant', 'Junior_Accountant'])

		const tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		const watermark = (await this.getWalletTransactionWatermarks(corporationId)).find(
			(entry) => entry.division === division
		)?.watermark
		const fetchResult = await esiFetch.fetchWalletTransactions(
			tokenStore,
			corporationId,
			division,
			characterId,
			watermark
		)
		if (fetchResult.truncated) {
			throw new Error('Wallet transaction pagination was truncated before persistence')
		}
		const transactions: EsiCorporationWalletTransaction[] = fetchResult.transactions

		logger
			.withTags({
				corporationId,
				division,
				operation: 'fetch_wallet_transactions',
			})
			.debug('Fetched wallet transactions from ESI', {
				totalTransactions: transactions.length,
				pagesFetched: fetchResult.pagesFetched,
				stoppedAtWatermark: fetchResult.stoppedAtWatermark,
				truncated: fetchResult.truncated,
			})

		let persistedNewRows = 0
		try {
			persistedNewRows = (
				await this.storeWalletTransactions(corporationId, division, transactions, watermark)
			).persistedNewRows
		} catch (error) {
			logger
				.withTags({
					corporationId,
					division,
					operation: 'fetch_wallet_transactions',
				})
				.error('Failed to insert transactions', {
					entriesPersisted: persistedNewRows,
					totalTransactions: transactions.length,
					error: error instanceof Error ? error.message : String(error),
					errorStack: error instanceof Error ? error.stack : undefined,
				})

			// Clear cache for this division so next attempt fetches fresh data
			const path = `/corporations/${corporationId}/wallets/${division}/transactions`
			try {
				await tokenStore.clearEsiCache(path, characterId)
				logger
					.withTags({
						corporationId,
						division,
						operation: 'fetch_wallet_transactions',
					})
					.debug('Cleared ESI cache after error', { path })
			} catch (clearError) {
				logger
					.withTags({
						corporationId,
						division,
						operation: 'fetch_wallet_transactions',
					})
					.error('Failed to clear cache', {
						error: clearError instanceof Error ? clearError.message : String(clearError),
					})
			}

			throw error
		}

		logger
			.withTags({
				corporationId,
				division,
				operation: 'fetch_wallet_transactions',
			})
			.debug('Completed wallet transactions fetch and store', {
				totalInserted: persistedNewRows,
				totalTransactions: transactions.length,
			})
	}

	/**
	 * Fetch and store corporation assets (paginated)
	 */
	private async fetchAndStoreAssets(corporationId: string, _forceRefresh = false): Promise<number> {
		logger.debug('[fetchAndStoreAssets] Starting asset fetch', { corporationId })

		const { characterId } = await this.getConfiguredCharacter(corporationId)
		logger.info('[EveCorporationData] fetchAndStoreAssets: Selected character', {
			corporationId,
			characterId,
		})

		await this.requireCorpRole(corporationId, characterId, ['Director'])

		logger.info('[EveCorporationData] fetchAndStoreAssets: Role verified', {
			corporationId,
			characterId,
		})

		try {
			const insertedCount = await this.fetchAndStoreAssetsByCharacter(corporationId, characterId)
			logger.debug('[fetchAndStoreAssets] Completed asset fetch and store', {
				corporationId,
				totalInserted: insertedCount,
				totalAssets: insertedCount,
			})
			return insertedCount
		} catch (error) {
			logger.error('[fetchAndStoreAssets] Failed to insert assets', {
				corporationId,
				error: error instanceof Error ? error.message : String(error),
				errorStack: error instanceof Error ? error.stack : undefined,
			})

			// Clear cache for this endpoint so next attempt fetches fresh data
			const tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
			const path = `/corporations/${corporationId}/assets`
			try {
				await tokenStore.clearEsiCache(path, characterId)
				logger.debug('[fetchAndStoreAssets] Cleared ESI cache after error', { path })
			} catch (clearError) {
				logger.error('[fetchAndStoreAssets] Failed to clear cache', {
					error: clearError instanceof Error ? clearError.message : String(clearError),
				})
			}

			throw error
		}
	}

	private async fetchAndStoreAssetsByCharacter(
		corporationId: string,
		characterId: string
	): Promise<number> {
		const tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		const basePath = `/corporations/${corporationId}/assets`
		const syncStartedAt = new Date()
		const result = await syncAssetsPaged({
			fetchPage: (page) =>
				withRpcResult(
					tokenStore.fetchEsi<RawEsiAsset[]>(`${basePath}?page=${page}`, characterId, {
						cacheMode: 'no-store',
					}),
					(response) =>
						({
							data: response.data.map((asset) => ({ ...asset })),
							pages: response.pages,
							page: response.page,
						}) as EsiResponse<RawEsiAsset[]>
				),
			storeAssets: (assets) => this.storeAssetsPage(corporationId, assets, syncStartedAt),
			onProgress: ({ page, totalPages, totalAssets }) => {
				if (page % 10 === 0 || page === totalPages) {
					logger.debug('[fetchAndStoreAssets] Page progress', {
						corporationId,
						page,
						totalPages,
						totalAssets,
					})
				}
			},
		})
		await this.getDb()
			.delete(corporationAssets)
			.where(
				and(
					eq(corporationAssets.corporationId, corporationId),
					lt(corporationAssets.updatedAt, syncStartedAt)
				)
			)
		logger.debug('[fetchAndStoreAssets] Pruned stale asset rows after successful sync', {
			corporationId,
		})
		try {
			await this.refreshStoredStructureFuelBurnRates(corporationId)
		} catch (error) {
			logger.warn('[EveCorporationData] Failed to refresh structure fuel rates after asset sync', {
				corporationId,
				error: error instanceof Error ? error.message : String(error),
			})
		}

		return result.assetsCount
	}

	private async fetchAndStoreStructureInventory(
		corporationId: string,
		forceRefresh = false
	): Promise<StructureInventorySyncResult> {
		if (!forceRefresh) {
			const nextAllowedAt = await this.getStructureInventoryNextAllowedAt(corporationId)
			if (nextAllowedAt) {
				logger.info('[EveCorporationData] Skipping structure inventory refresh due to cooldown', {
					corporationId,
					nextAllowedAt: nextAllowedAt.toISOString(),
				})
				return {
					assetsCount: 0,
					snapshotUpdated: false,
					skipReason: 'cooldown',
					ownedStructureCount: null,
					fetchedAssetCount: 0,
					inventoryRowCount: 0,
				}
			}
		}

		const { characterId } = await this.getConfiguredCharacter(corporationId)
		logger.info('[EveCorporationData] fetchAndStoreStructureInventory: Selected character', {
			corporationId,
			characterId,
		})

		await this.requireCorpRole(corporationId, characterId, ['Director'])

		logger.info('[EveCorporationData] fetchAndStoreStructureInventory: Role verified', {
			corporationId,
			characterId,
		})

		return await this.fetchAndStoreStructureInventoryByCharacter(corporationId, characterId, {
			forceRefresh,
		})
	}

	private async fetchAndStoreStructureInventoryByCharacter(
		corporationId: string,
		characterId: string,
		options?: { forceRefresh?: boolean }
	): Promise<StructureInventorySyncResult> {
		const config = await this.getDb().query.corporationConfig.findFirst({
			where: eq(corporationConfig.corporationId, corporationId),
		})
		if (!options?.forceRefresh && config?.assetsLastSync) {
			const nextAllowedAt = addHours(config.assetsLastSync, 1)
			if (nextAllowedAt > new Date()) {
				logger.info('[EveCorporationData] Skipping structure inventory refresh due to cooldown', {
					corporationId,
					lastSyncAt: config.assetsLastSync.toISOString(),
					nextAllowedAt: nextAllowedAt.toISOString(),
				})
				return {
					assetsCount: 0,
					snapshotUpdated: false,
					skipReason: 'cooldown',
					ownedStructureCount: null,
					fetchedAssetCount: 0,
					inventoryRowCount: 0,
				}
			}
		}

		let ownedStructureIds = await this.getOwnedStructureIds(corporationId)
		let structureRefreshFailed = false

		if (ownedStructureIds.size === 0) {
			logger.warn(
				'[EveCorporationData] No owned structures available for inventory filtering; attempting a structures refresh',
				{ corporationId }
			)

			try {
				await this.fetchAndStoreStructures(corporationId, true)
				ownedStructureIds = await this.getOwnedStructureIds(corporationId)
			} catch (error) {
				structureRefreshFailed = true
				logger.warn(
					'[EveCorporationData] Structures refresh fallback failed before inventory filtering',
					{
						corporationId,
						error: error instanceof Error ? error.message : String(error),
					}
				)
			}
		}

		if (ownedStructureIds.size === 0) {
			if (structureRefreshFailed) {
				throw new Error(
					`Unable to determine owned structures for ${corporationId}; refusing to clear or timestamp the inventory snapshot`
				)
			}

			logger.info(
				'[EveCorporationData] No owned structures found; clearing structure inventory snapshot',
				{
					corporationId,
				}
			)
			await this.storeStructureInventory(corporationId, [])
			await this.updateCorporationSyncTimestamp(corporationId, 'assetsLastSync')
			return {
				assetsCount: 0,
				snapshotUpdated: true,
				skipReason: 'no-owned-structures',
				ownedStructureCount: 0,
				fetchedAssetCount: 0,
				inventoryRowCount: 0,
			}
		}

		const tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		try {
			logger.info(
				'[EveCorporationData] fetchAndStoreStructureInventoryByCharacter: Refreshing raw assets and rebuilding structure inventory',
				{
					corporationId,
					ownedStructureCount: ownedStructureIds.size,
				}
			)
			const fetchedAssetCount = await this.fetchAndStoreAssetsByCharacter(
				corporationId,
				characterId
			)
			const inventoryCount = await this.storeStructureInventoryBatches(
				corporationId,
				ownedStructureIds,
				this.iterateStructureInventoryFromStoredAssets(corporationId, ownedStructureIds)
			)
			await this.updateCorporationSyncTimestamp(corporationId, 'assetsLastSync')
			logger.info('[EveCorporationData] Stored structure inventory snapshot', {
				corporationId,
				fetchedAssetCount,
				storedInventoryCount: inventoryCount,
			})

			return {
				assetsCount: inventoryCount,
				snapshotUpdated: true,
				skipReason: null,
				ownedStructureCount: ownedStructureIds.size,
				fetchedAssetCount,
				inventoryRowCount: inventoryCount,
			}
		} catch (error) {
			logger.error(
				'[fetchAndStoreStructureInventory] Failed to store structure inventory snapshot',
				{
					corporationId,
					error: error instanceof Error ? error.message : String(error),
					errorStack: error instanceof Error ? error.stack : undefined,
				}
			)

			const path = `/corporations/${corporationId}/assets`
			try {
				await tokenStore.clearEsiCache(path, characterId)
				logger.debug('[fetchAndStoreStructureInventory] Cleared ESI cache after error', {
					path,
				})
			} catch (clearError) {
				logger.error('[fetchAndStoreStructureInventory] Failed to clear cache', {
					error: clearError instanceof Error ? clearError.message : String(clearError),
				})
			}

			throw error
		}
	}

	/**
	 * Fetch and store corporation structures
	 */
	private async fetchAndStoreStructures(
		corporationId: string,
		_forceRefresh = false
	): Promise<void> {
		const { characterId } = await this.getConfiguredCharacter(corporationId)
		await this.requireCorpRole(corporationId, characterId, ['Station_Manager'])

		const tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		const structures: EsiCorporationStructure[] = await esiFetch.fetchStructures(
			tokenStore,
			corporationId,
			characterId
		)

		await this.storeStructures(corporationId, structures)
	}

	/**
	 * Fetch and store corporation market orders
	 */
	private async fetchAndStoreOrders(corporationId: string, _forceRefresh = false): Promise<void> {
		const { characterId } = await this.getConfiguredCharacter(corporationId)
		await this.requireCorpRole(corporationId, characterId, [
			'Accountant',
			'Junior_Accountant',
			'Trader',
		])

		const tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		const orders: EsiCorporationOrder[] = await esiFetch.fetchOrders(
			tokenStore,
			corporationId,
			characterId
		)

		// Batch insert to prevent timeouts
		const BATCH_SIZE = 25
		for (let i = 0; i < orders.length; i += BATCH_SIZE) {
			const batch = orders.slice(i, i + BATCH_SIZE)
			const valuesToInsert = batch.map((order) => ({
				corporationId: String(corporationId),
				orderId: order.order_id,
				duration: order.duration,
				escrow: order.escrow?.toString() || null,
				isBuyOrder: order.is_buy_order,
				issued: new Date(order.issued),
				issuedBy: order.issued_by,
				locationId: order.location_id,
				minVolume: order.min_volume ?? null,
				price: order.price.toString(),
				range: order.range,
				regionId: order.region_id,
				typeId: order.type_id,
				volumeRemain: order.volume_remain,
				volumeTotal: order.volume_total,
				walletDivision: order.wallet_division,
				updatedAt: new Date(),
			}))

			await this.getDb()
				.insert(corporationOrders)
				.values(valuesToInsert)
				.onConflictDoUpdate({
					target: [corporationOrders.corporationId, corporationOrders.orderId],
					set: {
						volumeRemain: sql`excluded.volume_remain`,
						price: sql`excluded.price`,
						updatedAt: sql`excluded.updated_at`,
					},
				})
		}
	}

	/**
	 * Fetch and store corporation contracts
	 */
	private async fetchAndStoreContracts(
		corporationId: string,
		_forceRefresh = false
	): Promise<void> {
		const { characterId } = await this.getConfiguredCharacter(corporationId)
		await this.requireCorpRole(corporationId, characterId, ['Director'])

		const tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		const contracts: EsiCorporationContract[] = await esiFetch.fetchContracts(
			tokenStore,
			corporationId,
			characterId
		)
		await this.replaceContractsSnapshot(corporationId, contracts)
	}

	private async replaceContractsSnapshot(
		_corporationId: string,
		contracts: EsiCorporationContract[]
	): Promise<void> {
		const normalizedContracts = this.dedupeContractsByContractId(contracts)
		const BATCH_SIZE = 20

		for (let i = 0; i < normalizedContracts.length; i += BATCH_SIZE) {
			const batch = normalizedContracts.slice(i, i + BATCH_SIZE)
			const valuesToInsert = batch.map((contract) => ({
				contractId: String(contract.contract_id),
				acceptorId: contract.acceptor_id?.toString() || null,
				assigneeId: contract.assignee_id.toString(),
				availability: contract.availability,
				buyout: contract.buyout?.toString() || null,
				collateral: contract.collateral?.toString() || null,
				dateAccepted: contract.date_accepted ? new Date(contract.date_accepted) : null,
				dateCompleted: contract.date_completed ? new Date(contract.date_completed) : null,
				dateExpired: new Date(contract.date_expired),
				dateIssued: new Date(contract.date_issued),
				daysToComplete: contract.days_to_complete ?? null,
				endLocationId: contract.end_location_id?.toString() || null,
				forCorporation: contract.for_corporation,
				issuerCorporationId: contract.issuer_corporation_id.toString(),
				issuerId: contract.issuer_id.toString(),
				price: contract.price?.toString() || null,
				reward: contract.reward?.toString() || null,
				startLocationId: contract.start_location_id?.toString() || null,
				status: contract.status,
				title: contract.title || null,
				type: contract.type,
				volume: contract.volume?.toString() || null,
				updatedAt: new Date(),
			}))

			await this.getDb()
				.insert(corporationContracts)
				.values(valuesToInsert)
				.onConflictDoUpdate({
					target: [corporationContracts.contractId],
					set: {
						acceptorId: sql`excluded.acceptor_id`,
						dateAccepted: sql`excluded.date_accepted`,
						dateCompleted: sql`excluded.date_completed`,
						status: sql`excluded.status`,
						updatedAt: sql`excluded.updated_at`,
					},
				})
		}

		this.courierLeaderboardCache.clear()
	}

	private dedupeContractsByContractId(
		contracts: EsiCorporationContract[]
	): EsiCorporationContract[] {
		const byContractId = new Map<string, EsiCorporationContract>()
		for (const contract of contracts) {
			byContractId.set(String(contract.contract_id), contract)
		}

		return [...byContractId.values()]
	}

	private getCourierLeaderboardCacheKey(
		allianceId: string,
		options?: {
			since?: Date
			before?: Date
		}
	): string {
		return [
			'alliance',
			allianceId,
			options?.since?.toISOString() ?? 'all',
			options?.before?.toISOString() ?? 'all',
		].join(':')
	}

	/**
	 * Fetch and store corporation industry jobs
	 */
	private async fetchAndStoreIndustryJobs(
		corporationId: string,
		_forceRefresh = false
	): Promise<void> {
		const { characterId } = await this.getConfiguredCharacter(corporationId)
		await this.requireCorpRole(corporationId, characterId, ['Factory_Manager'])

		const tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		const jobs: EsiCorporationIndustryJob[] = await esiFetch.fetchIndustryJobs(
			tokenStore,
			corporationId,
			characterId
		)

		// Batch insert to prevent timeouts
		const BATCH_SIZE = 20 // Industry jobs have many fields, use smaller batch
		for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
			const batch = jobs.slice(i, i + BATCH_SIZE)
			const valuesToInsert = batch.map((job) => ({
				corporationId: String(corporationId),
				jobId: job.job_id,
				installerId: job.installer_id,
				facilityId: job.facility_id,
				locationId: job.location_id,
				activityId: job.activity_id,
				blueprintId: job.blueprint_id,
				blueprintTypeId: job.blueprint_type_id,
				blueprintLocationId: job.blueprint_location_id,
				outputLocationId: job.output_location_id,
				runs: job.runs,
				cost: job.cost?.toString() || null,
				licensedRuns: job.licensed_runs ?? null,
				probability: job.probability?.toString() || null,
				productTypeId: job.product_type_id || null,
				status: job.status,
				duration: job.duration,
				startDate: new Date(job.start_date),
				endDate: new Date(job.end_date),
				pauseDate: job.pause_date ? new Date(job.pause_date) : null,
				completedDate: job.completed_date ? new Date(job.completed_date) : null,
				completedCharacterId: job.completed_character_id || null,
				successfulRuns: job.successful_runs ?? null,
				updatedAt: new Date(),
			}))

			await this.getDb()
				.insert(corporationIndustryJobs)
				.values(valuesToInsert)
				.onConflictDoUpdate({
					target: [corporationIndustryJobs.corporationId, corporationIndustryJobs.jobId],
					set: {
						status: sql`excluded.status`,
						pauseDate: sql`excluded.pause_date`,
						completedDate: sql`excluded.completed_date`,
						completedCharacterId: sql`excluded.completed_character_id`,
						successfulRuns: sql`excluded.successful_runs`,
						updatedAt: sql`excluded.updated_at`,
					},
				})
		}
	}

	/**
	 * Fetch and store corporation killmails
	 */
	private async fetchAndStoreKillmails(
		corporationId: string,
		_forceRefresh = false
	): Promise<void> {
		const { characterId } = await this.getConfiguredCharacter(corporationId)
		await this.requireCorpRole(corporationId, characterId, ['Director'])

		const tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		const killmails: EsiCorporationKillmail[] = await esiFetch.fetchKillmails(
			tokenStore,
			corporationId,
			characterId
		)

		// Batch insert to prevent timeouts
		const BATCH_SIZE = 50 // Killmails have few fields, can use larger batch
		for (let i = 0; i < killmails.length; i += BATCH_SIZE) {
			const batch = killmails.slice(i, i + BATCH_SIZE)
			const valuesToInsert = batch.map((km) => ({
				corporationId: String(corporationId),
				killmailId: km.killmail_id,
				killmailHash: km.killmail_hash,
				killmailTime: new Date(), // ESI doesn't provide time in this endpoint
				updatedAt: new Date(),
			}))

			await this.getDb()
				.insert(corporationKillmails)
				.values(valuesToInsert)
				.onConflictDoUpdate({
					target: [corporationKillmails.corporationId, corporationKillmails.killmailId],
					set: {
						killmailHash: sql`excluded.killmail_hash`,
						updatedAt: sql`excluded.updated_at`,
					},
				})
		}
	}

	// ========================================================================
	// FETCH ORCHESTRATION METHODS (public)
	// ========================================================================

	/**
	 * Fetch all accessible corporation data in parallel
	 */
	async fetchAllCorporationData(corporationId: string, forceRefresh = false): Promise<void> {
		this.assertNonNpcCorporation(corporationId)

		logger.debug('[EveCorporationData] fetchAllCorporationData: Starting', {
			corporationId,
			forceRefresh,
		})

		// Public data
		logger.debug('[EveCorporationData] fetchAllCorporationData: Fetching public data')
		await this.fetchPublicData(corporationId, forceRefresh)
		logger.debug('[EveCorporationData] fetchAllCorporationData: Public data fetched')

		// Try to fetch all other data, but don't fail if role verification fails
		logger.debug('[EveCorporationData] fetchAllCorporationData: Starting parallel fetches')
		const fetchPromises = [
			this.fetchCoreData(corporationId, forceRefresh).catch((e) =>
				logger.error('[EveCorporationData] Failed to fetch core data:', e)
			),
			this.fetchFinancialData(corporationId, undefined, forceRefresh).catch((e) =>
				logger.error('[EveCorporationData] Failed to fetch financial data:', e)
			),
			this.fetchAssetsData(corporationId, forceRefresh).catch((e) =>
				logger.error('[EveCorporationData] Failed to fetch assets data:', e)
			),
			this.fetchMarketData(corporationId, forceRefresh).catch((e) =>
				logger.error('[EveCorporationData] Failed to fetch market data:', e)
			),
			this.fetchKillmails(corporationId, forceRefresh).catch((e) =>
				logger.error('[EveCorporationData] Failed to fetch killmails:', e)
			),
		]

		const results = await Promise.allSettled(fetchPromises)
		logger.debug('[EveCorporationData] fetchAllCorporationData: All fetches completed', {
			fulfilled: results.filter((r) => r.status === 'fulfilled').length,
			rejected: results.filter((r) => r.status === 'rejected').length,
		})
	}

	/**
	 * Fetch public corporation data
	 */
	async fetchPublicData(corporationId: string, forceRefresh = false): Promise<void> {
		this.assertNonNpcCorporation(corporationId)
		await this.fetchAndStorePublicInfo(corporationId, forceRefresh)
	}

	/**
	 * Fetch core corporation data (members, tracking)
	 */
	async fetchCoreData(corporationId: string, forceRefresh = false): Promise<void> {
		this.assertNonNpcCorporation(corporationId)
		await Promise.all([
			this.fetchAndStoreMembers(corporationId, forceRefresh),
			this.fetchAndStoreMemberTracking(corporationId, forceRefresh).catch((e) =>
				logger.error('Member tracking failed:', e)
			),
		])
	}

	/**
	 * Fetch financial data (wallets, journal, transactions)
	 */
	async fetchFinancialData(
		corporationId: string,
		division?: number,
		forceRefresh = false
	): Promise<void> {
		this.assertNonNpcCorporation(corporationId)

		// Fetch wallets first
		await this.fetchAndStoreWallets(corporationId, forceRefresh)

		// Fetch journal and transactions for specified division(s)
		const divisions = division ? [division] : [1, 2, 3, 4, 5, 6, 7]

		logger
			.withTags({
				corporationId,
				operation: 'fetch_financial_data',
			})
			.debug('Fetching wallet journal and transactions for divisions', {
				divisions,
				totalDivisions: divisions.length,
			})

		const promises = divisions.flatMap((div) => [
			this.fetchAndStoreWalletJournal(corporationId, div, forceRefresh).catch((e) => {
				logger
					.withTags({
						corporationId,
						division: div,
						operation: 'fetch_financial_data',
					})
					.error('Failed to fetch journal for division', {
						division: div,
						error: e instanceof Error ? e.message : String(e),
					})
			}),
			this.fetchAndStoreWalletTransactions(corporationId, div, forceRefresh).catch((e) => {
				logger
					.withTags({
						corporationId,
						division: div,
						operation: 'fetch_financial_data',
					})
					.error('Failed to fetch transactions for division', {
						division: div,
						error: e instanceof Error ? e.message : String(e),
					})
			}),
		])

		const results = await Promise.allSettled(promises)

		// Count successes and failures
		const successful = results.filter((r) => r.status === 'fulfilled').length
		const failed = results.filter((r) => r.status === 'rejected').length

		logger
			.withTags({
				corporationId,
				operation: 'fetch_financial_data',
			})
			.debug('Completed financial data fetch', {
				divisions,
				totalOperations: results.length,
				successful,
				failed,
			})
	}

	/**
	 * Fetch structure inventory and structures
	 */
	async fetchAssetsData(corporationId: string, forceRefresh = false): Promise<void> {
		this.assertNonNpcCorporation(corporationId)
		await this.fetchAndStoreStructures(corporationId, forceRefresh)
		await this.fetchAndStoreStructureInventory(corporationId, forceRefresh)
	}

	/**
	 * Fetch and store corporation assets using a specific director character.
	 * This writes the raw corp asset snapshot and leaves filtering to callers.
	 */
	async fetchAssets(corporationId: string, forceRefresh = false): Promise<{ assetsCount: number }> {
		this.assertNonNpcCorporation(corporationId)
		const assetsCount = await this.fetchAndStoreAssets(corporationId, forceRefresh)
		return { assetsCount }
	}

	/**
	 * Fetch corporation structures
	 */
	async fetchStructures(corporationId: string, forceRefresh = false): Promise<void> {
		this.assertNonNpcCorporation(corporationId)
		await this.fetchAndStoreStructures(corporationId, forceRefresh)
	}

	/**
	 * Fetch market and industry data
	 */
	async fetchMarketData(corporationId: string, forceRefresh = false): Promise<void> {
		this.assertNonNpcCorporation(corporationId)
		await Promise.all([
			this.fetchAndStoreOrders(corporationId, forceRefresh).catch((e) =>
				logger.error('Orders fetch failed:', e)
			),
			this.fetchAndStoreContracts(corporationId, forceRefresh).catch((e) =>
				logger.error('Contracts fetch failed:', e)
			),
			this.fetchAndStoreIndustryJobs(corporationId, forceRefresh).catch((e) =>
				logger.error('Industry jobs fetch failed:', e)
			),
		])
	}

	/**
	 * Fetch killmails
	 */
	async fetchKillmails(corporationId: string, forceRefresh = false): Promise<void> {
		this.assertNonNpcCorporation(corporationId)
		await this.fetchAndStoreKillmails(corporationId, forceRefresh)
	}

	// ========================================================================
	// GETTER METHODS (public)
	// ========================================================================

	/**
	 * Get corporation public information
	 */
	async getCorporationInfo(corporationId: string): Promise<CorporationPublicData | null> {
		const result = await this.getDb().query.corporationPublicInfo.findFirst({
			where: eq(corporationPublicInfo.corporationId, corporationId),
		})

		if (!result) {
			return null
		}

		return {
			corporationId: result.corporationId,
			name: result.name,
			ticker: result.ticker,
			ceoId: result.ceoId,
			creatorId: result.creatorId,
			dateFounded: result.dateFounded,
			description: result.description,
			homeStationId: result.homeStationId,
			memberCount: result.memberCount,
			shares: result.shares,
			taxRate: result.taxRate,
			url: result.url,
			allianceId: result.allianceId,
			factionId: result.factionId,
			warEligible: result.warEligible,
			updatedAt: result.updatedAt,
		}
	}

	/**
	 * Get corporation members list
	 */
	async getMembers(corporationId: string): Promise<CorporationMemberData[]> {
		const cacheKey = `members:${corporationId}`

		// Check KV cache first
		try {
			const cached = await this.env.CACHE.get<CorporationMemberData[]>(cacheKey, 'json')
			if (cached) {
				// Convert updatedAt from string back to Date object
				return cached.map((m) => ({
					...m,
					updatedAt: new Date(m.updatedAt),
				}))
			}
		} catch (error) {
			// Cache read failure - log but continue to fetch from DB
			logger.warn('[Members Cache] Failed to read from KV', { corporationId, error })
		}

		// Cache miss or error - fetch from database
		const results = await this.getDb().query.corporationMembers.findMany({
			where: eq(corporationMembers.corporationId, corporationId),
		})

		const members = results.map((r) => ({
			id: r.id,
			corporationId: r.corporationId,
			characterId: r.characterId,
			updatedAt: r.updatedAt,
		}))

		// Store in KV cache with 30 minute TTL
		try {
			await this.env.CACHE.put(cacheKey, JSON.stringify(members), {
				expirationTtl: this.DIRECTORS_CACHE_TTL, // 30 * 60 seconds
			})
		} catch (error) {
			// Cache write failure - log but don't fail the request
			logger.warn('[Members Cache] Failed to write to KV', { corporationId, error })
		}

		return members
	}

	/**
	 * Get corporation members list as a backend-paginated page.
	 * Ordered by role (CEO, Director, Member) then character ID.
	 */
	async getMembersPaginated(
		corporationId: string,
		page: number,
		limit: number
	): Promise<CorporationMembersPageData> {
		const safePage = Math.max(1, Math.trunc(page))
		const safeLimit = Math.min(Math.max(1, Math.trunc(limit)), 200)

		const [corpInfo, totalRow] = await Promise.all([
			this.getDb().query.corporationPublicInfo.findFirst({
				where: eq(corporationPublicInfo.corporationId, corporationId),
				columns: {
					ceoId: true,
				},
			}),
			this.getDb()
				.select({
					count: sql<number>`count(*)`.as('count'),
				})
				.from(corporationMembers)
				.where(eq(corporationMembers.corporationId, corporationId))
				.then((rows) => rows[0] ?? { count: 0 }),
		])

		const totalItems = Number(totalRow.count ?? 0)
		const totalPages = Math.max(1, Math.ceil(totalItems / safeLimit))
		const currentPage = Math.min(safePage, totalPages)
		const pageOffset = (currentPage - 1) * safeLimit

		if (totalItems === 0) {
			return {
				items: [],
				pagination: {
					page: currentPage,
					limit: safeLimit,
					totalItems,
					totalPages,
					hasNextPage: false,
					hasPreviousPage: false,
				},
				summary: {
					total: 0,
					active: 0,
					inactive: 0,
					directors: 0,
				},
			}
		}

		const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
		const [activeCountRow, inactiveCountRow, directorCountRow] = await Promise.all([
			this.getDb()
				.select({
					count: sql<number>`count(*)`.as('count'),
				})
				.from(corporationMembers)
				.leftJoin(
					corporationMemberTracking,
					and(
						eq(corporationMemberTracking.corporationId, corporationMembers.corporationId),
						eq(corporationMemberTracking.characterId, corporationMembers.characterId)
					)
				)
				.where(
					and(
						eq(corporationMembers.corporationId, corporationId),
						gt(corporationMemberTracking.logonDate, sevenDaysAgo)
					)
				)
				.then((rows) => rows[0] ?? { count: 0 }),
			this.getDb()
				.select({
					count: sql<number>`count(*)`.as('count'),
				})
				.from(corporationMembers)
				.leftJoin(
					corporationMemberTracking,
					and(
						eq(corporationMemberTracking.corporationId, corporationMembers.corporationId),
						eq(corporationMemberTracking.characterId, corporationMembers.characterId)
					)
				)
				.where(
					and(
						eq(corporationMembers.corporationId, corporationId),
						lte(corporationMemberTracking.logonDate, sevenDaysAgo)
					)
				)
				.then((rows) => rows[0] ?? { count: 0 }),
			this.getDb()
				.select({
					count: sql<number>`count(*)`.as('count'),
				})
				.from(corporationMembers)
				.leftJoin(
					corporationDirectors,
					and(
						eq(corporationDirectors.corporationId, corporationMembers.corporationId),
						eq(corporationDirectors.characterId, corporationMembers.characterId)
					)
				)
				.where(
					and(
						eq(corporationMembers.corporationId, corporationId),
						sql`${corporationDirectors.characterId} is not null`,
						corpInfo?.ceoId
							? sql`${corporationMembers.characterId} <> ${corpInfo.ceoId}`
							: sql`1 = 1`
					)
				)
				.then((rows) => rows[0] ?? { count: 0 }),
		])

		const memberRows = await this.getDb()
			.select({
				characterId: corporationMembers.characterId,
				lastEsiUpdate: corporationMembers.updatedAt,
				joinDate: corporationMemberTracking.startDate,
				lastLogin: corporationMemberTracking.logonDate,
				directorCharacterId: corporationDirectors.characterId,
			})
			.from(corporationMembers)
			.leftJoin(
				corporationMemberTracking,
				and(
					eq(corporationMemberTracking.corporationId, corporationMembers.corporationId),
					eq(corporationMemberTracking.characterId, corporationMembers.characterId)
				)
			)
			.leftJoin(
				corporationDirectors,
				and(
					eq(corporationDirectors.corporationId, corporationMembers.corporationId),
					eq(corporationDirectors.characterId, corporationMembers.characterId)
				)
			)
			.where(eq(corporationMembers.corporationId, corporationId))
			.orderBy(
				sql`case
					when ${corpInfo?.ceoId ?? ''} <> '' and ${corporationMembers.characterId} = ${corpInfo?.ceoId ?? ''} then 0
					when ${corporationDirectors.characterId} is not null then 1
					else 2
				end`,
				corporationMembers.characterId
			)
			.limit(safeLimit)
			.offset(pageOffset)

		const now = Date.now()
		const sevenDaysMs = 7 * 24 * 60 * 60 * 1000

		const items = memberRows.map((row) => {
			const role: 'CEO' | 'Director' | 'Member' =
				corpInfo?.ceoId && row.characterId === corpInfo.ceoId
					? 'CEO'
					: row.directorCharacterId
						? 'Director'
						: 'Member'
			const activityStatus: 'active' | 'inactive' | 'unknown' = row.lastLogin
				? now - row.lastLogin.getTime() < sevenDaysMs
					? 'active'
					: 'inactive'
				: 'unknown'

			return {
				characterId: row.characterId,
				role,
				joinDate: row.joinDate,
				lastLogin: row.lastLogin,
				lastEsiUpdate: row.lastEsiUpdate,
				activityStatus,
			}
		})

		return {
			items,
			pagination: {
				page: currentPage,
				limit: safeLimit,
				totalItems,
				totalPages,
				hasNextPage: currentPage < totalPages,
				hasPreviousPage: currentPage > 1,
			},
			summary: {
				total: totalItems,
				active: Number(activeCountRow.count ?? 0),
				inactive: Number(inactiveCountRow.count ?? 0),
				directors: Number(directorCountRow.count ?? 0),
			},
		}
	}

	/**
	 * Get corporation IDs for a list of character IDs
	 * Queries the corporation_members table across all corporations
	 */
	async getCorporationIdsByCharacterIds(characterIds: string[]): Promise<Record<string, string>> {
		if (characterIds.length === 0) {
			return {}
		}

		logger.debug('[EveCorporationData] getCorporationIdsByCharacterIds: Starting', {
			characterIdsCount: characterIds.length,
		})

		// Query corporation_members table for all matching character IDs
		const results = await this.getDb().query.corporationMembers.findMany({
			where: inArray(corporationMembers.characterId, characterIds),
			columns: {
				characterId: true,
				corporationId: true,
			},
		})

		// Build result map: characterId -> corporationId
		const result: Record<string, string> = {}
		for (const row of results) {
			result[row.characterId] = row.corporationId
		}

		logger.debug('[EveCorporationData] getCorporationIdsByCharacterIds: Completed', {
			characterIdsCount: characterIds.length,
			foundCount: results.length,
			resultCount: Object.keys(result).length,
		})

		return result
	}

	/**
	 * Get corporation member tracking data
	 */
	async getMemberTracking(corporationId: string): Promise<CorporationMemberTrackingData[]> {
		const results = await this.getDb().query.corporationMemberTracking.findMany({
			where: eq(corporationMemberTracking.corporationId, corporationId),
		})

		return results.map((r) => ({
			...r,
		}))
	}

	/**
	 * Clean up stale member data by syncing with current ESI member list
	 * This is a one-time operation to remove members who are no longer in the corporation
	 * Returns the number of members removed
	 */
	async cleanupStaleMemberData(corporationId: string): Promise<{
		membersRemoved: number
		characterIds: string[]
	}> {
		// Fetch current members from ESI
		const { characterId } = await this.getConfiguredCharacter(corporationId)
		const tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')

		const currentMemberIds = await withRpcResult(
			tokenStore.fetchEsi<number[]>(`/corporations/${corporationId}/members`, characterId, {
				cacheMode: 'no-store',
			}),
			(response) => new Set(response.data.map(String))
		)

		// Fetch all members from database
		const dbMembers = await this.getDb()
			.select({ characterId: corporationMembers.characterId })
			.from(corporationMembers)
			.where(eq(corporationMembers.corporationId, corporationId))

		// Identify stale members (in database but not in ESI)
		const staleMemberIds = dbMembers
			.filter((m) => !currentMemberIds.has(m.characterId))
			.map((m) => m.characterId)

		if (staleMemberIds.length === 0) {
			logger.debug('[cleanupStaleMemberData] No stale members found:', { corporationId })
			return { membersRemoved: 0, characterIds: [] }
		}

		// Remove stale members from database
		await this.getDb()
			.delete(corporationMembers)
			.where(
				and(
					eq(corporationMembers.corporationId, corporationId),
					inArray(corporationMembers.characterId, staleMemberIds)
				)
			)

		// Remove stale member tracking
		await this.getDb()
			.delete(corporationMemberTracking)
			.where(
				and(
					eq(corporationMemberTracking.corporationId, corporationId),
					inArray(corporationMemberTracking.characterId, staleMemberIds)
				)
			)

		// Send HR cleanup messages
		const hrQueue = this.env['hr-member-departed']
		const messages = staleMemberIds.map((characterId) => ({
			body: {
				corporationId,
				characterId,
			},
		}))

		await hrQueue.sendBatch(messages)

		// Invalidate cache
		await this.invalidateMembersCache(corporationId)

		logger.debug('[cleanupStaleMemberData] Cleanup completed:', {
			corporationId,
			membersRemoved: staleMemberIds.length,
			characterIds: staleMemberIds,
		})

		return {
			membersRemoved: staleMemberIds.length,
			characterIds: staleMemberIds,
		}
	}

	/**
	 * Get corporation core data
	 */
	async getCoreData(corporationId: string): Promise<CorporationCoreData | null> {
		const [publicInfo, members, memberTracking] = await Promise.all([
			this.getCorporationInfo(corporationId),
			this.getMembers(corporationId),
			this.getMemberTracking(corporationId),
		])

		if (!publicInfo) {
			return null
		}

		return {
			publicInfo,
			members,
			memberTracking,
		}
	}

	/**
	 * Get corporation wallets
	 */
	async getWallets(corporationId: string, division?: number): Promise<CorporationWalletData[]> {
		const results = division
			? await this.getDb().query.corporationWallets.findMany({
					where: and(
						eq(corporationWallets.corporationId, corporationId),
						eq(corporationWallets.division, division)
					),
				})
			: await this.getDb().query.corporationWallets.findMany({
					where: eq(corporationWallets.corporationId, corporationId),
				})

		return results.map((r) => ({
			id: r.id,
			corporationId: r.corporationId,
			division: r.division,
			balance: r.balance,
			updatedAt: r.updatedAt,
		}))
	}

	/**
	 * Get wallet journal entries
	 */
	async getWalletJournal(
		corporationId: string,
		division?: number,
		limit = 10000
	): Promise<CorporationWalletJournalData[]> {
		const results = division
			? await this.getDb().query.corporationWalletJournal.findMany({
					where: and(
						eq(corporationWalletJournal.corporationId, corporationId),
						eq(corporationWalletJournal.division, division)
					),
					orderBy: desc(corporationWalletJournal.date),
					limit,
				})
			: await this.getDb().query.corporationWalletJournal.findMany({
					where: eq(corporationWalletJournal.corporationId, corporationId),
					orderBy: desc(corporationWalletJournal.date),
					limit,
				})

		return results.map((r) => ({
			id: r.id,
			corporationId: r.corporationId,
			division: r.division,
			journalId: r.journalId,
			amount: r.amount,
			balance: r.balance,
			contextId: r.contextId,
			contextIdType: r.contextIdType,
			date: r.date,
			description: r.description,
			firstPartyId: r.firstPartyId,
			reason: r.reason,
			refType: r.refType,
			secondPartyId: r.secondPartyId,
			tax: r.tax,
			taxReceiverId: r.taxReceiverId,
			updatedAt: r.updatedAt,
		}))
	}

	/**
	 * Get wallet transactions
	 */
	async getWalletTransactions(
		corporationId: string,
		division?: number,
		limit = 10000
	): Promise<CorporationWalletTransactionData[]> {
		const results = division
			? await this.getDb().query.corporationWalletTransactions.findMany({
					where: and(
						eq(corporationWalletTransactions.corporationId, corporationId),
						eq(corporationWalletTransactions.division, division)
					),
					orderBy: desc(corporationWalletTransactions.date),
					limit,
				})
			: await this.getDb().query.corporationWalletTransactions.findMany({
					where: eq(corporationWalletTransactions.corporationId, corporationId),
					orderBy: desc(corporationWalletTransactions.date),
					limit,
				})

		return results.map((r) => ({
			id: r.id,
			corporationId: r.corporationId,
			division: r.division,
			transactionId: r.transactionId,
			clientId: r.clientId,
			date: r.date,
			isBuy: r.isBuy,
			isPersonal: r.isPersonal,
			journalRefId: r.journalRefId,
			locationId: r.locationId,
			quantity: r.quantity,
			typeId: r.typeId,
			unitPrice: r.unitPrice,
			updatedAt: r.updatedAt,
		}))
	}

	async getWalletJournalWindow(
		corporationId: string,
		filters: WalletJournalWindowFilters = {}
	): Promise<CorporationWalletJournalData[]> {
		const limit = Math.min(Math.max(filters.limit ?? 1000, 1), 10000)
		const offset = Math.max(filters.offset ?? 0, 0)
		const conditions: SQL[] = [eq(corporationWalletJournal.corporationId, corporationId)]
		if (filters.division !== undefined) {
			conditions.push(eq(corporationWalletJournal.division, filters.division))
		}
		if (filters.refTypes && filters.refTypes.length > 0) {
			conditions.push(inArray(corporationWalletJournal.refType, filters.refTypes))
		}
		if (filters.firstPartyId) {
			conditions.push(eq(corporationWalletJournal.firstPartyId, filters.firstPartyId))
		}
		if (filters.secondPartyId) {
			conditions.push(eq(corporationWalletJournal.secondPartyId, filters.secondPartyId))
		}
		if (filters.fromDate) {
			conditions.push(gte(corporationWalletJournal.date, filters.fromDate))
		}
		if (filters.toDate) {
			conditions.push(lte(corporationWalletJournal.date, filters.toDate))
		}
		const minAmount = Number(filters.minAmount)
		if (Number.isFinite(minAmount)) {
			conditions.push(sql`CAST(${corporationWalletJournal.amount} AS numeric) >= ${minAmount}`)
		}
		const maxAmount = Number(filters.maxAmount)
		if (Number.isFinite(maxAmount)) {
			conditions.push(sql`CAST(${corporationWalletJournal.amount} AS numeric) <= ${maxAmount}`)
		}

		const rows = await this.getDb().query.corporationWalletJournal.findMany({
			where: and(...conditions),
			orderBy: [desc(corporationWalletJournal.date), desc(corporationWalletJournal.journalId)],
			limit,
			offset,
		})

		return rows.map((r) => ({
			id: r.id,
			corporationId: r.corporationId,
			division: r.division,
			journalId: r.journalId,
			amount: r.amount,
			balance: r.balance,
			contextId: r.contextId,
			contextIdType: r.contextIdType,
			date: r.date,
			description: r.description,
			firstPartyId: r.firstPartyId,
			reason: r.reason,
			refType: r.refType,
			secondPartyId: r.secondPartyId,
			tax: r.tax,
			taxReceiverId: r.taxReceiverId,
			updatedAt: r.updatedAt,
		}))
	}

	async getWalletTransactionsWindow(
		corporationId: string,
		filters: WalletTransactionWindowFilters = {}
	): Promise<CorporationWalletTransactionData[]> {
		const limit = Math.min(Math.max(filters.limit ?? 1000, 1), 10000)
		const offset = Math.max(filters.offset ?? 0, 0)
		const conditions: SQL[] = [eq(corporationWalletTransactions.corporationId, corporationId)]
		if (filters.division !== undefined) {
			conditions.push(eq(corporationWalletTransactions.division, filters.division))
		}
		if (filters.clientId) {
			conditions.push(eq(corporationWalletTransactions.clientId, filters.clientId))
		}
		if (filters.journalRefId) {
			conditions.push(eq(corporationWalletTransactions.journalRefId, filters.journalRefId))
		}
		if (filters.fromDate) {
			conditions.push(gte(corporationWalletTransactions.date, filters.fromDate))
		}
		if (filters.toDate) {
			conditions.push(lte(corporationWalletTransactions.date, filters.toDate))
		}
		const minUnitPrice = Number(filters.minUnitPrice)
		if (Number.isFinite(minUnitPrice)) {
			conditions.push(
				sql`CAST(${corporationWalletTransactions.unitPrice} AS numeric) >= ${minUnitPrice}`
			)
		}
		const maxUnitPrice = Number(filters.maxUnitPrice)
		if (Number.isFinite(maxUnitPrice)) {
			conditions.push(
				sql`CAST(${corporationWalletTransactions.unitPrice} AS numeric) <= ${maxUnitPrice}`
			)
		}

		const rows = await this.getDb().query.corporationWalletTransactions.findMany({
			where: and(...conditions),
			orderBy: [
				desc(corporationWalletTransactions.date),
				desc(corporationWalletTransactions.transactionId),
			],
			limit,
			offset,
		})

		return rows.map((r) => ({
			id: r.id,
			corporationId: r.corporationId,
			division: r.division,
			transactionId: r.transactionId,
			clientId: r.clientId,
			date: r.date,
			isBuy: r.isBuy,
			isPersonal: r.isPersonal,
			journalRefId: r.journalRefId,
			locationId: r.locationId,
			quantity: r.quantity,
			typeId: r.typeId,
			unitPrice: r.unitPrice,
			updatedAt: r.updatedAt,
		}))
	}

	async getWalletDivisions(corporationId: string): Promise<number[]> {
		const wallets = await this.getWallets(corporationId)
		const divisions = new Set<number>()
		for (const wallet of wallets) {
			divisions.add(wallet.division)
		}
		return Array.from(divisions).sort((a, b) => a - b)
	}

	async getCorporationTaxMetadata(corporationId: string): Promise<CorporationTaxMetadata | null> {
		const publicInfo = await this.getCorporationInfo(corporationId)
		if (!publicInfo) {
			return null
		}

		const taxRateDecimal = Number(publicInfo.taxRate)
		return {
			corporationId,
			inGameTaxRateBps: Number.isFinite(taxRateDecimal)
				? Math.round(taxRateDecimal * 10_000)
				: null,
			ceoId: publicInfo.ceoId,
			memberCount: publicInfo.memberCount,
			allianceId: publicInfo.allianceId,
			updatedAt: publicInfo.updatedAt,
		}
	}

	async getCorporationSyncHealth(corporationId: string): Promise<CorporationSyncHealth> {
		const config = await this.getDb().query.corporationConfig.findFirst({
			where: eq(corporationConfig.corporationId, corporationId),
		})

		return {
			corporationId,
			isConfigured: !!config,
			lastVerified: config?.lastVerified ?? null,
			sync: {
				membersLastSync: config?.membersLastSync ?? null,
				memberTrackingLastSync: config?.memberTrackingLastSync ?? null,
				walletsLastSync: config?.walletsLastSync ?? null,
				walletJournalLastSync: config?.walletJournalLastSync ?? null,
				walletTransactionsLastSync: config?.walletTransactionsLastSync ?? null,
				assetsLastSync: config?.assetsLastSync ?? null,
				structuresLastSync: config?.structuresLastSync ?? null,
				ordersLastSync: config?.ordersLastSync ?? null,
				contractsLastSync: config?.contractsLastSync ?? null,
				industryJobsLastSync: config?.industryJobsLastSync ?? null,
				killmailsLastSync: config?.killmailsLastSync ?? null,
			},
		}
	}

	async getCorporationAuthStatus(corporationId: string): Promise<CorporationAuthStatus> {
		const config = await this.getDb().query.corporationConfig.findFirst({
			where: eq(corporationConfig.corporationId, corporationId),
		})
		const directors = config ? await this.getDirectors(corporationId) : []
		const healthyDirectorCount = directors.filter((director) => director.isHealthy).length
		const tokenStoreStub = this.getEveTokenStoreStub()
		const scopeSet = new Set<string>()

		await Promise.all(
			directors.map(async (director) => {
				try {
					const tokenInfo = await withRpcResult(
						tokenStoreStub.getTokenInfo(director.characterId),
						(info) => (info ? { isExpired: info.isExpired, scopes: [...info.scopes] } : null)
					)
					if (!tokenInfo || tokenInfo.isExpired) {
						return
					}
					for (const scope of tokenInfo.scopes) {
						scopeSet.add(scope)
					}
				} catch (error) {
					logger.warn('[EveCorporationData] Failed to resolve director token scopes', {
						corporationId,
						directorCharacterId: director.characterId,
						error: error instanceof Error ? error.message : String(error),
					})
				}
			})
		)

		const requiredScopes = [REQUIRED_CORPORATION_WALLET_SCOPE]
		const missingRequiredScopes = requiredScopes.filter((scope) => !scopeSet.has(scope))
		const hasCorporationWalletScope = scopeSet.has(REQUIRED_CORPORATION_WALLET_SCOPE)
		const hasCharacterWalletScope = scopeSet.has(CHARACTER_WALLET_SCOPE)
		const hasCorporationMembershipScope = scopeSet.has(CORPORATION_MEMBERSHIP_SCOPE)

		return {
			corporationId,
			isConfigured: !!config,
			isVerified: config?.isVerified ?? false,
			lastVerified: config?.lastVerified ?? null,
			directorCount: directors.length,
			healthyDirectorCount,
			requiredScopes,
			missingRequiredScopes,
			hasRequiredScopes: missingRequiredScopes.length === 0,
			hasCorporationWalletScope,
			hasCharacterWalletScope,
			hasCorporationMembershipScope,
			grantedScopeCount: scopeSet.size,
		}
	}

	/**
	 * Get complete financial data
	 */
	async getFinancialData(
		corporationId: string,
		division?: number
	): Promise<CorporationFinancialData | null> {
		const [wallets, journalEntries, transactions] = await Promise.all([
			this.getWallets(corporationId, division),
			this.getWalletJournal(corporationId, division),
			this.getWalletTransactions(corporationId, division),
		])

		if (wallets.length === 0 && journalEntries.length === 0 && transactions.length === 0) {
			return null
		}

		return {
			wallets,
			journalEntries,
			transactions,
		}
	}

	private async getCachedAssets(
		corporationId: string,
		filters?: SearchAssetsFilters
	): Promise<CorporationAssetData[]> {
		const where: SQL[] = [eq(corporationAssets.corporationId, corporationId)]
		if (filters?.itemId) {
			where.push(eq(corporationAssets.itemId, filters.itemId))
		}
		if (filters?.isSingleton) {
			where.push(eq(corporationAssets.isSingleton, filters.isSingleton))
		}
		if (filters?.locationFlag) {
			where.push(eq(corporationAssets.locationFlag, filters.locationFlag))
		}
		if (filters?.locationId) {
			where.push(eq(corporationAssets.locationId, filters.locationId))
		}
		if (filters?.locationType) {
			where.push(eq(corporationAssets.locationType, filters.locationType))
		}
		if (filters?.quantity) {
			where.push(eq(corporationAssets.quantity, filters.quantity))
		}
		if (filters?.typeId) {
			where.push(eq(corporationAssets.typeId, filters.typeId))
		}
		if (filters?.isBlueprintCopy) {
			where.push(eq(corporationAssets.isBlueprintCopy, filters.isBlueprintCopy))
		}
		const results = await this.getDb().query.corporationAssets.findMany({
			where: and(...where),
			orderBy: [desc(corporationAssets.updatedAt), asc(corporationAssets.itemId)],
			limit: filters?.limit,
		})
		return results
	}

	async searchAssets(
		corporationId: string,
		filters?: SearchAssetsFilters
	): Promise<CorporationAssetData[]> {
		const results = await this.getCachedAssets(corporationId, filters)
		return results
	}

	/**
	 * Get corporation assets
	 */
	async getAssets(corporationId: string, limit = 10000): Promise<CorporationAssetData[]> {
		const results = await this.getDb().query.corporationAssets.findMany({
			where: eq(corporationAssets.corporationId, corporationId),
			limit,
		})

		return results.map((r) => ({
			id: r.id,
			corporationId: r.corporationId,
			itemId: r.itemId,
			isSingleton: r.isSingleton,
			locationFlag: r.locationFlag,
			locationId: r.locationId,
			locationType: r.locationType,
			quantity: r.quantity,
			typeId: r.typeId,
			isBlueprintCopy: r.isBlueprintCopy,
			updatedAt: r.updatedAt,
		}))
	}

	async getStructureInventory(
		corporationId: string,
		structureId?: string,
		limit?: number
	): Promise<CorporationStructureInventoryData[]> {
		const activeSnapshotId = await this.getActiveStructureInventorySnapshotId(corporationId)
		if (activeSnapshotId === null) {
			return []
		}

		const where = structureId
			? and(
					eq(corporationStructureInventory.corporationId, corporationId),
					eq(corporationStructureInventory.snapshotId, activeSnapshotId),
					eq(corporationStructureInventory.structureId, structureId)
				)
			: and(
					eq(corporationStructureInventory.corporationId, corporationId),
					eq(corporationStructureInventory.snapshotId, activeSnapshotId)
				)

		const results = await this.getDb().query.corporationStructureInventory.findMany({
			where,
			orderBy: [
				asc(corporationStructureInventory.structureId),
				asc(corporationStructureInventory.locationFlag),
				asc(corporationStructureInventory.typeId),
				asc(corporationStructureInventory.itemId),
			],
			limit,
		})

		return results.map((row) => ({
			id: row.id,
			corporationId: row.corporationId,
			structureId: row.structureId,
			itemId: row.itemId,
			isSingleton: row.isSingleton,
			locationFlag: row.locationFlag,
			locationType: row.locationType,
			quantity: row.quantity,
			typeId: row.typeId,
			updatedAt: row.updatedAt,
		}))
	}

	/**
	 * Get corporation structures
	 */
	async getStructures(
		corporationId: string,
		filters?: CorporationStructureQuery
	): Promise<CorporationStructureData[]> {
		const conditions = [eq(corporationStructures.corporationId, corporationId)]
		if (filters?.lowPower === 'true') {
			conditions.push(eq(corporationStructures.lowPower, true))
		} else if (filters?.lowPower === 'false') {
			conditions.push(eq(corporationStructures.lowPower, false))
		}
		if (filters?.regionId) {
			conditions.push(eq(corporationStructures.regionId, filters.regionId))
		}
		if (filters?.systemId) {
			conditions.push(eq(corporationStructures.systemId, filters.systemId))
		}
		if (filters?.state) {
			conditions.push(eq(corporationStructures.state, filters.state))
		}
		if (filters?.typeId) {
			conditions.push(eq(corporationStructures.typeId, filters.typeId))
		}

		const results = await this.getDb().query.corporationStructures.findMany({
			where: conditions.length > 1 ? and(...conditions) : conditions[0],
		})

		return results.map((r) => ({
			id: r.id,
			corporationId: r.corporationId,
			structureId: r.structureId,
			name: r.name,
			typeId: r.typeId,
			typeName: r.typeName,
			systemId: r.systemId,
			systemName: r.systemName,
			regionId: r.regionId,
			regionName: r.regionName,
			profileId: r.profileId,
			fuelExpires: r.fuelExpires,
			fuelAmount: r.fuelAmount,
			fuelBurnRate: r.fuelBurnRate,
			nextReinforceApply: r.nextReinforceApply,
			nextReinforceHour: r.nextReinforceHour,
			reinforceHour: r.reinforceHour,
			state: r.state,
			stateTimerEnd: r.stateTimerEnd,
			stateTimerStart: r.stateTimerStart,
			unanchorsAt: r.unanchorsAt,
			lowPower: r.lowPower,
			syncStatus: r.syncStatus,
			syncFailureReason: r.syncFailureReason,
			lastSyncedAt: r.lastSyncedAt,
			services: r.services,
			updatedAt: r.updatedAt,
		}))
	}

	/**
	 * Get structure details from the synced corporation snapshot.
	 */
	async getStructureDetails(
		corporationId: string,
		structureId: string
	): Promise<CorporationStructureData | null> {
		const structure = await this.getDb().query.corporationStructures.findFirst({
			where: and(
				eq(corporationStructures.corporationId, corporationId),
				eq(corporationStructures.structureId, structureId)
			),
		})

		if (!structure) {
			return null
		}

		return {
			id: structure.id,
			corporationId: structure.corporationId,
			structureId: structure.structureId,
			name: structure.name,
			typeId: structure.typeId,
			typeName: structure.typeName,
			systemId: structure.systemId,
			systemName: structure.systemName,
			regionId: structure.regionId,
			regionName: structure.regionName,
			profileId: structure.profileId,
			fuelExpires: structure.fuelExpires,
			fuelAmount: structure.fuelAmount,
			fuelBurnRate: structure.fuelBurnRate,
			nextReinforceApply: structure.nextReinforceApply,
			nextReinforceHour: structure.nextReinforceHour,
			reinforceHour: structure.reinforceHour,
			state: structure.state,
			stateTimerEnd: structure.stateTimerEnd,
			stateTimerStart: structure.stateTimerStart,
			unanchorsAt: structure.unanchorsAt,
			lowPower: structure.lowPower,
			syncStatus: structure.syncStatus,
			syncFailureReason: structure.syncFailureReason,
			lastSyncedAt: structure.lastSyncedAt,
			services: structure.services,
			updatedAt: structure.updatedAt,
		}
	}

	/**
	 * Get complete assets data
	 */
	async getAssetsData(corporationId: string): Promise<CorporationAssetsData | null> {
		const [assets, structures, structureInventory] = await Promise.all([
			this.getAssets(corporationId),
			this.getStructures(corporationId),
			this.getStructureInventory(corporationId),
		])

		if (assets.length === 0 && structures.length === 0 && structureInventory.length === 0) {
			return null
		}

		return {
			assets,
			structures,
			structureInventory,
		}
	}

	/**
	 * Get corporation market orders
	 */
	async getOrders(corporationId: string): Promise<CorporationOrderData[]> {
		const results = await this.getDb().query.corporationOrders.findMany({
			where: eq(corporationOrders.corporationId, corporationId),
		})

		return results.map((r) => ({
			id: r.id,
			corporationId: r.corporationId,
			orderId: r.orderId,
			duration: r.duration,
			escrow: r.escrow,
			isBuyOrder: r.isBuyOrder,
			issued: r.issued,
			issuedBy: r.issuedBy,
			locationId: r.locationId,
			minVolume: r.minVolume,
			price: r.price,
			range: r.range,
			regionId: r.regionId,
			typeId: r.typeId,
			volumeRemain: r.volumeRemain,
			volumeTotal: r.volumeTotal,
			walletDivision: r.walletDivision,
			updatedAt: r.updatedAt,
		}))
	}

	/**
	 * Get corporation contracts
	 */
	async getContracts(corporationId: string, status?: string): Promise<CorporationContractData[]> {
		const baseWhere = or(
			eq(corporationContracts.assigneeId, corporationId),
			eq(corporationContracts.issuerId, corporationId)
		)

		const results = status
			? await this.getDb().query.corporationContracts.findMany({
					where: and(baseWhere, eq(corporationContracts.status, status)),
				})
			: await this.getDb().query.corporationContracts.findMany({
					where: baseWhere,
				})

		return results.map((r) => ({
			id: r.id,
			contractId: r.contractId,
			acceptorId: r.acceptorId,
			assigneeId: r.assigneeId,
			availability: r.availability,
			buyout: r.buyout,
			collateral: r.collateral,
			dateAccepted: r.dateAccepted,
			dateCompleted: r.dateCompleted,
			dateExpired: r.dateExpired,
			dateIssued: r.dateIssued,
			daysToComplete: r.daysToComplete,
			endLocationId: r.endLocationId,
			forCorporation: r.forCorporation,
			issuerCorporationId: r.issuerCorporationId,
			issuerId: r.issuerId,
			price: r.price,
			reward: r.reward,
			startLocationId: r.startLocationId,
			status: r.status,
			title: r.title,
			type: r.type,
			volume: r.volume,
			updatedAt: r.updatedAt,
		}))
	}

	/**
	 * Get alliance courier contracts by assignee ID
	 */
	async getAllianceCourierContracts(
		allianceId: string,
		status?: string,
		page = 1,
		limit = 25,
		sortBy: CorporationContractSortBy = 'expires',
		sortDirection: SortDirection = 'asc'
	): Promise<CorporationContractsPageData> {
		const safePage = Math.max(1, Math.trunc(page))
		const safeLimit = Math.min(Math.max(1, Math.trunc(limit)), 100)
		const conditions: SQL[] = [
			eq(corporationContracts.assigneeId, allianceId),
			eq(corporationContracts.type, 'courier'),
			gt(corporationContracts.dateExpired, new Date()),
		]
		if (status) {
			conditions.push(eq(corporationContracts.status, status))
		}

		const results = await this.getDb()
			.selectDistinctOn([corporationContracts.contractId])
			.from(corporationContracts)
			.where(and(...conditions))
			.orderBy(corporationContracts.contractId, desc(corporationContracts.dateIssued))

		const mapped = results.map((r) => this.mapAllianceCourierContract(r))
		const sorted = [...mapped].sort((left, right) =>
			this.compareAllianceCourierContracts(left, right, sortBy, sortDirection)
		)

		const totalItems = sorted.length
		const totalPages = Math.max(1, Math.ceil(totalItems / safeLimit))
		const currentPage = Math.min(safePage, totalPages)
		const pageOffset = (currentPage - 1) * safeLimit

		if (totalItems === 0) {
			return {
				items: [],
				pagination: {
					page: currentPage,
					limit: safeLimit,
					totalItems,
					totalPages,
					hasNextPage: false,
					hasPreviousPage: false,
				},
			}
		}

		const pageItems = sorted.slice(pageOffset, pageOffset + safeLimit)

		return {
			items: pageItems,
			pagination: {
				page: currentPage,
				limit: safeLimit,
				totalItems,
				totalPages,
				hasNextPage: currentPage < totalPages,
				hasPreviousPage: currentPage > 1,
			},
		}
	}

	/**
	 * Get leaderboard for completed courier contracts assigned to an alliance
	 */
	async getCourierLeaderboard(
		allianceId: string,
		options?: {
			since?: Date
			before?: Date
		}
	): Promise<CourierLeaderboard> {
		const cacheKey = this.getCourierLeaderboardCacheKey(allianceId, options)
		return this.courierLeaderboardCache.getOrSet(cacheKey, async () => {
			const conditions: SQL[] = [
				eq(corporationContracts.assigneeId, allianceId),
				eq(corporationContracts.type, 'courier'),
				eq(corporationContracts.status, 'finished'),
				isNotNull(corporationContracts.acceptorId),
			]
			if (options?.since) {
				conditions.push(gte(corporationContracts.dateCompleted, options.since))
			}
			if (options?.before) {
				conditions.push(lt(corporationContracts.dateCompleted, options.before))
			}

			const distinctContracts = this.getDb()
				.selectDistinctOn([corporationContracts.contractId], {
					contractId: corporationContracts.contractId,
					acceptorId: corporationContracts.acceptorId,
					volume: corporationContracts.volume,
					reward: corporationContracts.reward,
					dateCompleted: corporationContracts.dateCompleted,
				})
				.from(corporationContracts)
				.where(and(...conditions))
				.as('distinct_contracts')

			const results = await this.getDb()
				.select({
					acceptorId: distinctContracts.acceptorId,
					contractsCompleted: sql<number>`count(*)`.as('contracts_completed'),
					totalVolume:
						sql<number>`coalesce(sum(cast(${distinctContracts.volume} as numeric)), 0)`.as(
							'total_volume'
						),
					totalReward:
						sql<number>`coalesce(sum(cast(${distinctContracts.reward} as numeric)), 0)`.as(
							'total_reward'
						),
					oldestContract: sql<Date | null>`min(${distinctContracts.dateCompleted})`.as(
						'oldest_contract'
					),
				})
				.from(distinctContracts)
				.groupBy(distinctContracts.acceptorId)
				.orderBy(sql`count(*) desc`)

			const entries = results.map((r) => ({
				acceptorId: r.acceptorId!,
				contractsCompleted: Number(r.contractsCompleted),
				totalVolume: Number(r.totalVolume),
				totalReward: Number(r.totalReward),
			}))

			const oldestContractDate = results.reduce<Date | null>((min, r) => {
				if (!r.oldestContract) return min
				const d = new Date(r.oldestContract)
				return min === null || d < min ? d : min
			}, null)

			return { entries, oldestContractDate }
		})
	}

	/**
	 * Get corporation industry jobs
	 */
	async getIndustryJobs(
		corporationId: string,
		status?: string
	): Promise<CorporationIndustryJobData[]> {
		const results = status
			? await this.getDb().query.corporationIndustryJobs.findMany({
					where: and(
						eq(corporationIndustryJobs.corporationId, corporationId),
						eq(corporationIndustryJobs.status, status)
					),
				})
			: await this.getDb().query.corporationIndustryJobs.findMany({
					where: eq(corporationIndustryJobs.corporationId, corporationId),
				})

		return results.map((r) => ({
			id: r.id,
			corporationId: r.corporationId,
			jobId: r.jobId,
			installerId: r.installerId,
			facilityId: r.facilityId,
			locationId: r.locationId,
			activityId: r.activityId,
			blueprintId: r.blueprintId,
			blueprintTypeId: r.blueprintTypeId,
			blueprintLocationId: r.blueprintLocationId,
			outputLocationId: r.outputLocationId,
			runs: r.runs,
			cost: r.cost,
			licensedRuns: r.licensedRuns,
			probability: r.probability,
			productTypeId: r.productTypeId,
			status: r.status,
			duration: r.duration,
			startDate: r.startDate,
			endDate: r.endDate,
			pauseDate: r.pauseDate,
			completedDate: r.completedDate,
			completedCharacterId: r.completedCharacterId,
			successfulRuns: r.successfulRuns,
			updatedAt: r.updatedAt,
		}))
	}

	/**
	 * Get complete market data
	 */
	async getMarketData(corporationId: string): Promise<CorporationMarketData | null> {
		const [orders, contracts, industryJobs] = await Promise.all([
			this.getOrders(corporationId),
			this.getContracts(corporationId),
			this.getIndustryJobs(corporationId),
		])

		if (orders.length === 0 && contracts.length === 0 && industryJobs.length === 0) {
			return null
		}

		return {
			orders,
			contracts,
			industryJobs,
		}
	}

	/**
	 * Get corporation killmails
	 */
	async getKillmails(corporationId: string, limit = 100): Promise<CorporationKillmailData[]> {
		const results = await this.getDb().query.corporationKillmails.findMany({
			where: eq(corporationKillmails.corporationId, corporationId),
			orderBy: desc(corporationKillmails.killmailTime),
			limit,
		})

		return results.map((r) => ({
			id: r.id,
			corporationId: r.corporationId,
			killmailId: r.killmailId,
			killmailHash: r.killmailHash,
			killmailTime: r.killmailTime,
			updatedAt: r.updatedAt,
		}))
	}

	/**
	 * Get character's corporation roles
	 */
	async getCharacterRoles(
		corporationId: string,
		characterId: string
	): Promise<CharacterCorporationRolesData | null> {
		const result = await this.getDb().query.characterCorporationRoles.findFirst({
			where: and(
				eq(characterCorporationRoles.corporationId, corporationId),
				eq(characterCorporationRoles.characterId, characterId)
			),
		})

		if (!result) {
			return null
		}

		return {
			id: result.id,
			corporationId: result.corporationId,
			characterId: result.characterId,
			roles: result.roles,
			rolesAtHq: result.rolesAtHq || undefined,
			rolesAtBase: result.rolesAtBase || undefined,
			rolesAtOther: result.rolesAtOther || undefined,
			updatedAt: result.updatedAt,
		}
	}

	/**
	 * Fetch handler for HTTP requests (minimal implementation)
	 */
	async fetch(_request: Request): Promise<Response> {
		return new Response('EveCorporationData Durable Object', { status: 200 })
	}
}

export function buildSkyhookBaseStructureRow(input: {
	corporationId: string
	skyhook: EsiCorporationSkyhook
	planet: UniversePlanetGeography | null
	system: UniverseSolarSystem | null
	region: UniverseRegion | null
	existingRow: Pick<
		SkyhookBaseStructureRow,
		'systemId' | 'systemName' | 'regionId' | 'regionName' | 'updatedAt'
	> | null
	observedAt: Date
}): SkyhookBaseStructureRow | null {
	const { corporationId, skyhook, planet, system, region, existingRow, observedAt } = input
	const resolvedSystemId = planet?.solarSystemId ?? existingRow?.systemId ?? null
	if (!resolvedSystemId) {
		return null
	}

	const resolvedSystemName =
		planet?.solarSystemName ?? system?.solarSystemName ?? existingRow?.systemName ?? null
	const resolvedRegionId = system?.regionId ?? existingRow?.regionId ?? null
	const resolvedRegionName = region?.regionName ?? existingRow?.regionName ?? null

	return {
		structureId: skyhook.structure_id,
		corporationId,
		name: null,
		typeId: ORBITAL_SKYHOOK_TYPE_ID,
		typeName: 'Orbital Skyhook',
		systemId: resolvedSystemId,
		systemName: resolvedSystemName,
		regionId: resolvedRegionId,
		regionName: resolvedRegionName,
		profileId: 'skyhook',
		fuelExpires: null,
		fuelAmount: null,
		lastRefilledAt: null,
		nextReinforceApply: null,
		nextReinforceHour: null,
		reinforceHour: null,
		state: normalizeSkyhookState(
			skyhook.state,
			parseDateOrNull(skyhook.reinforcement_timer?.end) ?? null
		),
		stateTimerEnd: skyhook.reinforcement_timer?.end
			? new Date(skyhook.reinforcement_timer.end)
			: null,
		stateTimerStart: null,
		unanchorsAt: null,
		lowPower: false,
		syncStatus: 'ok',
		syncFailureReason: null,
		lastSyncedAt: observedAt,
		services: [],
		updatedAt: observedAt,
	}
}
