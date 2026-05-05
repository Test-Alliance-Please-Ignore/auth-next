import { DurableObject } from 'cloudflare:workers'

import { count } from 'drizzle-orm'

import { and, asc, desc, eq, gte, inArray, isNotNull, sql } from '@repo/db-utils'

import { createDb } from './db'
import {
	characterNameCache,
	extractionSettings,
	moonScanOres,
	moonScans,
	structureProfiles,
	verifiedCompositions,
} from './db/schema'

import type { schema } from './db'
import type {
	ExtractionSettings,
	LeaderboardEntry,
	LeaderboardWindow,
	MoonCoverageStat,
	MoonScan,
	MoonScanDO as IMoonScanDO,
	MoonScanOre,
	PaginatedScans,
	ScanFilters,
	StructureProfile,
	StructureType,
	SubmitScanInput,
	VerifiedComposition,
} from '@repo/moon-scan'
import type { DbClient } from './db'
import type { Env } from './context'

export class MoonScanDO extends DurableObject<Env> implements IMoonScanDO {
	private db: DbClient<typeof schema>

	constructor(state: DurableObjectState, env: Env) {
		super(state, env)
		this.db = createDb(env.DATABASE_URL)
	}

	async submitScans(scans: SubmitScanInput[], submittedBy: string | null, autoVerify: boolean): Promise<MoonScan[]> {
		const results: MoonScan[] = []

		for (const scan of scans) {
			const [inserted] = await this.db
				.insert(moonScans)
				.values({
					moonId: scan.moonId,
					submittedBy,
					status: autoVerify ? 'verified' : 'pending',
					source: 'user',
					verifiedBy: autoVerify ? submittedBy : null,
					verifiedAt: autoVerify ? new Date() : null,
				})
				.returning()

			if (scan.ores.length > 0) {
				await this.db.insert(moonScanOres).values(
					scan.ores.map((ore) => ({
						scanId: inserted.id,
						oreTypeId: ore.oreTypeId,
						quantity: ore.quantity,
					}))
				)
			}

			if (autoVerify) {
				await this.db
					.insert(verifiedCompositions)
					.values({
						moonId: scan.moonId,
						sourceScanId: inserted.id,
						verifiedBy: submittedBy,
					})
					.onConflictDoUpdate({
						target: verifiedCompositions.moonId,
						set: {
							sourceScanId: inserted.id,
							verifiedAt: new Date(),
							verifiedBy: submittedBy,
						},
					})
			}

			results.push(await this._buildScan(inserted, scan.ores.map((o) => ({ ...o, id: '', scanId: inserted.id }))))
		}

		return results
	}

	async getScans(filters: ScanFilters): Promise<PaginatedScans> {
		const { status, moonId, submittedBy, page = 1, pageSize = 20 } = filters
		const offset = (page - 1) * pageSize

		const conditions = []
		if (status) conditions.push(eq(moonScans.status, status))
		if (moonId) conditions.push(eq(moonScans.moonId, moonId))
		if (submittedBy) conditions.push(eq(moonScans.submittedBy, submittedBy))

		const where = conditions.length > 0 ? and(...conditions) : undefined

		const [{ total }] = await this.db
			.select({ total: count() })
			.from(moonScans)
			.where(where)

		const rows = await this.db
			.select()
			.from(moonScans)
			.where(where)
			.orderBy(desc(moonScans.submittedAt))
			.limit(pageSize)
			.offset(offset)

		const scanIds = rows.map((r) => r.id)
		const ores = scanIds.length > 0
			? await this.db.select().from(moonScanOres).where(inArray(moonScanOres.scanId, scanIds))
			: []

		const oresByScanId = new Map<string, typeof ores>()
		for (const ore of ores) {
			const list = oresByScanId.get(ore.scanId) ?? []
			list.push(ore)
			oresByScanId.set(ore.scanId, list)
		}

		const items = rows.map((row) => this._buildScan(row, oresByScanId.get(row.id) ?? []))

		return { items, total, page, pageSize }
	}

	async getScan(scanId: string): Promise<MoonScan | null> {
		const [row] = await this.db.select().from(moonScans).where(eq(moonScans.id, scanId))
		if (!row) return null
		const ores = await this.db.select().from(moonScanOres).where(eq(moonScanOres.scanId, scanId))
		return this._buildScan(row, ores)
	}

	async verifyScan(scanId: string, verifiedBy: string, notes: string | null): Promise<MoonScan> {
		const [updated] = await this.db
			.update(moonScans)
			.set({ status: 'verified', verifiedBy, verifiedAt: new Date(), notes })
			.where(eq(moonScans.id, scanId))
			.returning()

		await this.db
			.insert(verifiedCompositions)
			.values({
				moonId: updated.moonId,
				sourceScanId: updated.id,
				verifiedBy,
			})
			.onConflictDoUpdate({
				target: verifiedCompositions.moonId,
				set: {
					sourceScanId: updated.id,
					verifiedAt: new Date(),
					verifiedBy,
				},
			})

		const ores = await this.db.select().from(moonScanOres).where(eq(moonScanOres.scanId, scanId))
		return this._buildScan(updated, ores)
	}

	async rejectScan(scanId: string, verifiedBy: string, notes: string | null): Promise<MoonScan> {
		const [updated] = await this.db
			.update(moonScans)
			.set({ status: 'rejected', verifiedBy, verifiedAt: new Date(), notes })
			.where(eq(moonScans.id, scanId))
			.returning()

		const ores = await this.db.select().from(moonScanOres).where(eq(moonScanOres.scanId, scanId))
		return this._buildScan(updated, ores)
	}

	async getVerifiedComposition(moonId: string): Promise<VerifiedComposition | null> {
		const [vc] = await this.db
			.select()
			.from(verifiedCompositions)
			.where(eq(verifiedCompositions.moonId, moonId))

		if (!vc) return null
		return this._buildVerifiedComposition(vc)
	}

	async getVerifiedCompositions(moonIds: string[]): Promise<VerifiedComposition[]> {
		if (moonIds.length === 0) return []
		const vcs = await this.db
			.select()
			.from(verifiedCompositions)
			.where(inArray(verifiedCompositions.moonId, moonIds))

		// Batch-load all ores for these compositions in one query
		const scanIds = vcs.map((vc) => vc.sourceScanId)
		const allOres = scanIds.length > 0
			? await this.db.select({ scanId: moonScanOres.scanId, oreTypeId: moonScanOres.oreTypeId, quantity: moonScanOres.quantity })
				.from(moonScanOres)
				.where(inArray(moonScanOres.scanId, scanIds))
			: []

		const oresByScanId = new Map<string, Array<{ oreTypeId: string; quantity: string }>>()
		for (const ore of allOres) {
			const list = oresByScanId.get(ore.scanId) ?? []
			list.push({ oreTypeId: ore.oreTypeId, quantity: ore.quantity })
			oresByScanId.set(ore.scanId, list)
		}

		return vcs.map((vc) => ({
			moonId: vc.moonId,
			sourceScanId: vc.sourceScanId,
			verifiedAt: vc.verifiedAt.toISOString(),
			verifiedBy: vc.verifiedBy,
			ores: oresByScanId.get(vc.sourceScanId) ?? [],
		}))
	}

	async getVerifiedCompositionsBySystem(systemId: string): Promise<VerifiedComposition[]> {
		// moonId format: "40XXXXXXX" — system moons share the same solar system prefix
		// We query by moonId prefix since moonId contains the system relationship
		// The route passes in individual moon IDs from Universe DO for accuracy
		// This method is kept for convenience when systemId IS a moon prefix
		const rows = await this.db
			.select()
			.from(verifiedCompositions)
			.where(sql`${verifiedCompositions.moonId} like ${systemId + '%'}`)

		return Promise.all(rows.map((vc) => this._buildVerifiedComposition(vc)))
	}

	async getLeaderboard(window: LeaderboardWindow): Promise<LeaderboardEntry[]> {
		const windowFilter = window === 'all'
			? undefined
			: window === '7d'
				? gte(moonScans.submittedAt, sql`now() - interval '7 days'`)
				: gte(moonScans.submittedAt, sql`now() - interval '30 days'`)

		// Count verified scans per submitter (join on sourceScanId)
		const conditions = [
			isNotNull(moonScans.submittedBy),
			isNotNull(verifiedCompositions.moonId),
		]
		if (windowFilter) conditions.push(windowFilter)

		const rows = await this.db
			.select({
				characterId: moonScans.submittedBy,
				scanCount: count(),
			})
			.from(moonScans)
			.innerJoin(verifiedCompositions, eq(verifiedCompositions.sourceScanId, moonScans.id))
			.where(and(...conditions))
			.groupBy(moonScans.submittedBy)
			.orderBy(desc(count()))
			.limit(100)

		const characterIds = rows
			.map((r) => r.characterId)
			.filter((id): id is string => id !== null)

		const names = characterIds.length > 0
			? await this.db
				.select()
				.from(characterNameCache)
				.where(inArray(characterNameCache.characterId, characterIds))
			: []

		const nameMap = new Map(names.map((n) => [n.characterId, n.name]))

		return rows
			.filter((r): r is typeof r & { characterId: string } => r.characterId !== null)
			.map((r) => ({
				characterId: r.characterId,
				characterName: nameMap.get(r.characterId) ?? r.characterId,
				scanCount: r.scanCount,
			}))
	}

	async getScanSummary(): Promise<{ scannedMoonIds: string[]; verifiedMoonIds: string[] }> {
		const [scanned, verified] = await Promise.all([
			this.db.selectDistinct({ moonId: moonScans.moonId }).from(moonScans),
			this.db.select({ moonId: verifiedCompositions.moonId }).from(verifiedCompositions),
		])
		return {
			scannedMoonIds: scanned.map((r) => r.moonId),
			verifiedMoonIds: verified.map((r) => r.moonId),
		}
	}

	async getMoonCoverage(moonIds: string[]): Promise<MoonCoverageStat[]> {
		if (moonIds.length === 0) return []

		const scannedMoonIds = await this.db
			.selectDistinct({ moonId: moonScans.moonId })
			.from(moonScans)
			.where(inArray(moonScans.moonId, moonIds))

		const verifiedMoonIds = await this.db
			.select({ moonId: verifiedCompositions.moonId })
			.from(verifiedCompositions)
			.where(inArray(verifiedCompositions.moonId, moonIds))

		const scannedSet = new Set(scannedMoonIds.map((r) => r.moonId))
		const verifiedSet = new Set(verifiedMoonIds.map((r) => r.moonId))

		return moonIds.map((moonId) => ({
			moonId,
			hasScans: scannedSet.has(moonId),
			isVerified: verifiedSet.has(moonId),
		}))
	}

	async resolveCharacterNames(characterIds: string[]): Promise<Record<string, string>> {
		if (characterIds.length === 0) return {}
		const rows = await this.db
			.select()
			.from(characterNameCache)
			.where(inArray(characterNameCache.characterId, characterIds))
		return Object.fromEntries(rows.map((r) => [r.characterId, r.name]))
	}

	async getExtractionSettings(): Promise<ExtractionSettings> {
		const [row] = await this.db
			.select()
			.from(extractionSettings)
			.where(eq(extractionSettings.id, 'default'))

		if (!row) {
			// Return hardcoded defaults if row missing (before seed runs)
			return {
				defaultReprocessingYield: '0.80',
				defaultCycleDays: 30,
				fuelBlockPriceOverride: null,
				magmaticGasPriceOverride: null,
			}
		}

		return {
			defaultReprocessingYield: row.defaultReprocessingYield,
			defaultCycleDays: row.defaultCycleDays,
			fuelBlockPriceOverride: row.fuelBlockPriceOverride,
			magmaticGasPriceOverride: row.magmaticGasPriceOverride,
		}
	}

	async updateExtractionSettings(settings: Partial<ExtractionSettings>): Promise<ExtractionSettings> {
		const current = await this.getExtractionSettings()
		const merged = { ...current, ...settings }

		await this.db
			.insert(extractionSettings)
			.values({
				id: 'default',
				defaultReprocessingYield: merged.defaultReprocessingYield,
				defaultCycleDays: merged.defaultCycleDays,
				fuelBlockPriceOverride: merged.fuelBlockPriceOverride,
				magmaticGasPriceOverride: merged.magmaticGasPriceOverride,
			})
			.onConflictDoUpdate({
				target: extractionSettings.id,
				set: {
					defaultReprocessingYield: merged.defaultReprocessingYield,
					defaultCycleDays: merged.defaultCycleDays,
					fuelBlockPriceOverride: merged.fuelBlockPriceOverride,
					magmaticGasPriceOverride: merged.magmaticGasPriceOverride,
					updatedAt: new Date(),
				},
			})

		return merged
	}

	async getStructureProfiles(): Promise<StructureProfile[]> {
		const rows = await this.db.select().from(structureProfiles).orderBy(asc(structureProfiles.id))
		return rows.map(this._mapStructureProfile)
	}

	async updateStructureProfile(id: StructureType, profile: Partial<StructureProfile>): Promise<StructureProfile> {
		const [updated] = await this.db
			.update(structureProfiles)
			.set({
				...(profile.baseVolumePerHr !== undefined && { baseVolumePerHr: profile.baseVolumePerHr }),
				...(profile.rigBonus !== undefined && { rigBonus: profile.rigBonus }),
				...(profile.fuelPerHr !== undefined && { fuelPerHr: profile.fuelPerHr }),
				...(profile.magmaticGasPerHr !== undefined && { magmaticGasPerHr: profile.magmaticGasPerHr }),
				...(profile.minCycleDays !== undefined && { minCycleDays: profile.minCycleDays }),
				...(profile.maxCycleDays !== undefined && { maxCycleDays: profile.maxCycleDays }),
				...(profile.isPassive !== undefined && { isPassive: profile.isPassive }),
				...(profile.lowsecModifier !== undefined && { lowsecModifier: profile.lowsecModifier }),
				...(profile.nullsecModifier !== undefined && { nullsecModifier: profile.nullsecModifier }),
			})
			.where(eq(structureProfiles.id, id))
			.returning()

		return this._mapStructureProfile(updated)
	}

	async cacheCharacterName(characterId: string, name: string): Promise<void> {
		await this.db
			.insert(characterNameCache)
			.values({ characterId, name, cachedAt: new Date() })
			.onConflictDoUpdate({
				target: characterNameCache.characterId,
				set: { name, cachedAt: new Date() },
			})
	}

	// ─── Private helpers ──────────────────────────────────────────────────────

	private _buildScan(
		row: typeof moonScans.$inferSelect,
		ores: Array<{ oreTypeId: string; quantity: string }>
	): MoonScan {
		return {
			id: row.id,
			moonId: row.moonId,
			submittedBy: row.submittedBy,
			submittedAt: row.submittedAt.toISOString(),
			status: row.status,
			source: row.source,
			verifiedBy: row.verifiedBy,
			verifiedAt: row.verifiedAt?.toISOString() ?? null,
			notes: row.notes,
			ores: ores.map((o) => ({ oreTypeId: o.oreTypeId, quantity: o.quantity })),
		}
	}

	private async _buildVerifiedComposition(
		vc: typeof verifiedCompositions.$inferSelect
	): Promise<VerifiedComposition> {
		const ores = await this.db
			.select({ oreTypeId: moonScanOres.oreTypeId, quantity: moonScanOres.quantity })
			.from(moonScanOres)
			.where(eq(moonScanOres.scanId, vc.sourceScanId))

		return {
			moonId: vc.moonId,
			sourceScanId: vc.sourceScanId,
			verifiedAt: vc.verifiedAt.toISOString(),
			verifiedBy: vc.verifiedBy,
			ores,
		}
	}

	private _mapStructureProfile(row: typeof structureProfiles.$inferSelect): StructureProfile {
		return {
			id: row.id as StructureType,
			baseVolumePerHr: row.baseVolumePerHr,
			rigBonus: row.rigBonus,
			fuelPerHr: row.fuelPerHr,
			magmaticGasPerHr: row.magmaticGasPerHr,
			minCycleDays: row.minCycleDays,
			maxCycleDays: row.maxCycleDays,
			isPassive: row.isPassive,
			lowsecModifier: row.lowsecModifier,
			nullsecModifier: row.nullsecModifier,
		}
	}
}
