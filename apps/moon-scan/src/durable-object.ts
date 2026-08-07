import { DurableObject } from 'cloudflare:workers'
import { count } from 'drizzle-orm'

import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, isNull, or, sql } from '@repo/db-utils'
import { logger } from '@repo/hono-helpers'
import { FUEL_BLOCK_TYPE_ID, MAGMATIC_GAS_TYPE_ID } from '@repo/moon-scan'

import { createDb } from './db'
import {
	characterNameCache,
	extractionSettings,
	moonScanOres,
	moonScans,
	structureProfiles,
	verifiedCompositions,
	verifiedMoonSummaries,
} from './db/schema'

import type {
	ExtractionSettings,
	MoonScanDO as IMoonScanDO,
	LeaderboardEntry,
	LeaderboardWindow,
	MoonCoverageStat,
	MoonProfitabilityQueryInputs,
	MoonScan,
	OreRarity,
	PaginatedScans,
	ScanFilters,
	ScanLocation,
	ScannedMoonRegionCount,
	StructureProfile,
	StructureType,
	SubmitScanInput,
	VerifiedComposition,
	VerifiedMoonPage,
	VerifiedMoonRegionCount,
	VerifiedMoonsSortBy,
	VerifiedMoonSummaryRecord,
} from '@repo/moon-scan'
import type { Env } from './context'
import type { DbClient, schema } from './db'

const BATCH_SIZE = 500

function chunkArray<T>(items: readonly T[], size: number): T[][] {
	const chunks: T[][] = []
	for (let index = 0; index < items.length; index += size) {
		chunks.push(items.slice(index, index + size) as T[])
	}
	return chunks
}

export class MoonScanDO extends DurableObject<Env> implements IMoonScanDO {
	private db: DbClient<typeof schema>

	constructor(state: DurableObjectState, env: Env) {
		super(state, env)
		this.db = createDb(env.DATABASE_URL)

		void state.blockConcurrencyWhile(async () => {
			await this.initializeVerifiedMoonSummarySchema()
		})
	}

	private async initializeVerifiedMoonSummarySchema(): Promise<void> {
		try {
			await this.db.execute(
				sql.raw(`
				CREATE TABLE IF NOT EXISTS "moon_verified_moon_summaries" (
					"moon_id" text PRIMARY KEY NOT NULL,
					"source_scan_id" text NOT NULL REFERENCES "moon_scans"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
					"verified_at" timestamp with time zone DEFAULT now() NOT NULL,
					"verified_by" text,
					"moon_name" text NOT NULL,
					"solar_system_id" text NOT NULL,
					"solar_system_name" text NOT NULL,
					"region_id" text NOT NULL,
					"region_name" text NOT NULL,
					"constellation_id" text NOT NULL,
					"constellation_name" text NOT NULL,
					"security_status" text,
					"highest_rarity" text
				)
			`)
			)
		} catch (error) {
			logger.error('Failed to initialize moon verified summary schema', { error })
			throw error
		}
	}

	async submitScans(
		scans: SubmitScanInput[],
		submittedBy: string | null,
		autoVerify: boolean
	): Promise<MoonScan[]> {
		const results: MoonScan[] = []

		for (const scan of scans) {
			const [inserted] = await this.db
				.insert(moonScans)
				.values({
					moonId: scan.moonId,
					regionId: scan.regionId,
					solarSystemId: scan.solarSystemId,
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

			results.push(
				await this._buildScan(
					inserted,
					scan.ores.map((o) => ({ ...o, id: '', scanId: inserted.id }))
				)
			)
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

		const [{ total }] = await this.db.select({ total: count() }).from(moonScans).where(where)

		const rows = await this.db
			.select()
			.from(moonScans)
			.where(where)
			.orderBy(desc(moonScans.submittedAt))
			.limit(pageSize)
			.offset(offset)

		const scanIds = rows.map((r) => r.id)
		const ores =
			scanIds.length > 0
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

	async verifyScans(
		scanIds: string[],
		verifiedBy: string,
		notes: string | null
	): Promise<MoonScan[]> {
		const results: MoonScan[] = []
		for (const scanId of [...new Set(scanIds)]) {
			results.push(await this.verifyScan(scanId, verifiedBy, notes))
		}
		return results
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

	async rejectScans(
		scanIds: string[],
		verifiedBy: string,
		notes: string | null
	): Promise<MoonScan[]> {
		const results: MoonScan[] = []
		for (const scanId of [...new Set(scanIds)]) {
			results.push(await this.rejectScan(scanId, verifiedBy, notes))
		}
		return results
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

		const uniqueMoonIds = [...new Set(moonIds)]
		const vcs: Array<typeof verifiedCompositions.$inferSelect> = []
		for (const moonIdChunk of chunkArray(uniqueMoonIds, BATCH_SIZE)) {
			const rows = await this.db
				.select()
				.from(verifiedCompositions)
				.where(inArray(verifiedCompositions.moonId, moonIdChunk))
			vcs.push(...rows)
		}

		// Batch-load all ores for these compositions in one query
		const scanIds = vcs.map((vc) => vc.sourceScanId)
		const allOres: Array<{ scanId: string; oreTypeId: string; quantity: string }> = []
		for (const scanIdChunk of chunkArray([...new Set(scanIds)], BATCH_SIZE)) {
			const rows =
				scanIdChunk.length > 0
					? await this.db
							.select({
								scanId: moonScanOres.scanId,
								oreTypeId: moonScanOres.oreTypeId,
								quantity: moonScanOres.quantity,
							})
							.from(moonScanOres)
							.where(inArray(moonScanOres.scanId, scanIdChunk))
					: []
			allOres.push(...rows)
		}

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

	async getVerifiedMoonPage(filters: {
		page: number
		pageSize: number
		regionId?: string
		constellationId?: string
		rarity?: OreRarity[]
		search?: string
		sortBy: VerifiedMoonsSortBy
		sortDir: 'asc' | 'desc'
		profitability?: MoonProfitabilityQueryInputs
	}): Promise<VerifiedMoonPage> {
		const offset = (filters.page - 1) * filters.pageSize
		const conditions = []

		if (filters.regionId) {
			conditions.push(eq(verifiedMoonSummaries.regionId, filters.regionId))
		}
		if (filters.constellationId) {
			conditions.push(eq(verifiedMoonSummaries.constellationId, filters.constellationId))
		}
		if (filters.rarity && filters.rarity.length > 0) {
			conditions.push(
				inArray(
					verifiedMoonSummaries.highestRarity,
					filters.rarity.map((rarity) => rarity)
				)
			)
		}
		if (filters.search) {
			const q = `%${filters.search.trim()}%`
			conditions.push(
				or(
					ilike(verifiedMoonSummaries.moonName, q),
					ilike(verifiedMoonSummaries.solarSystemName, q)
				)
			)
		}

		const where = conditions.length > 0 ? and(...conditions) : undefined
		const [{ total }] = await this.db
			.select({ total: count() })
			.from(verifiedMoonSummaries)
			.where(where)

		const constellations = filters.regionId
			? await this.db
					.selectDistinct({
						constellationId: verifiedMoonSummaries.constellationId,
						constellationName: verifiedMoonSummaries.constellationName,
					})
					.from(verifiedMoonSummaries)
					.where(eq(verifiedMoonSummaries.regionId, filters.regionId))
					.orderBy(asc(verifiedMoonSummaries.constellationName))
			: await this.db
					.selectDistinct({
						constellationId: verifiedMoonSummaries.constellationId,
						constellationName: verifiedMoonSummaries.constellationName,
					})
					.from(verifiedMoonSummaries)
					.orderBy(asc(verifiedMoonSummaries.constellationName))

		if (filters.profitability) {
			// Keep the small pricing context as query parameters so compositions stay in SQL.
			const inputs = filters.profitability
			const materialRows = inputs.typeMaterials.map((material) => ({
				ore_type_id: material.oreTypeId,
				material_type_id: material.materialTypeId,
				quantity: material.quantity,
				ore_volume: inputs.oreVolumes[material.oreTypeId] ?? 1,
			}))
			const profileRows = inputs.profiles.map((profile) => ({
				id: profile.id,
				base_volume_per_hr: profile.baseVolumePerHr,
				rig_bonus: profile.rigBonus,
				fuel_per_hr: profile.fuelPerHr,
				magmatic_gas_per_hr: profile.magmaticGasPerHr,
				nullsec_modifier: profile.nullsecModifier,
				is_passive: profile.isPassive,
			}))
			const priceRows = inputs.prices.map((price) => ({
				type_id: price.typeId,
				price: price.price,
			}))
			const orderColumn =
				filters.sortBy === 'metenoxProfit'
					? 'metenox_profit'
					: filters.sortBy === 'tataraProfit'
						? 'tatara_profit'
						: filters.sortBy === 'moonName'
							? 'moon_name'
							: filters.sortBy === 'solarSystemName'
								? 'solar_system_name'
								: filters.sortBy === 'regionName'
									? 'region_name'
									: filters.sortBy === 'securityStatus'
										? 'security_status_value'
										: 'rarity_order'
			const direction = filters.sortDir === 'asc' ? 'asc' : 'desc'
			const orderSql = sql.raw(`${orderColumn} ${direction} nulls last, moon_name asc, moon_id asc`)
			const rawConditions = []
			if (filters.regionId) rawConditions.push(sql`s.region_id = ${filters.regionId}`)
			if (filters.constellationId)
				rawConditions.push(sql`s.constellation_id = ${filters.constellationId}`)
			if (filters.rarity && filters.rarity.length > 0) {
				rawConditions.push(
					sql`s.highest_rarity in (${sql.join(
						filters.rarity.map((rarity) => sql`${rarity}`),
						sql`, `
					)})`
				)
			}
			if (filters.search) {
				const search = `%${filters.search.trim()}%`
				rawConditions.push(
					sql`(s.moon_name ilike ${search} or s.solar_system_name ilike ${search})`
				)
			}
			const rawWhere =
				rawConditions.length > 0 ? sql`where ${sql.join(rawConditions, sql` and `)}` : sql``
			const pricingSql = sql`
				with pricing_settings as (
					select
						${inputs.defaultReprocessingYield}::numeric as reprocessing_yield,
						${inputs.defaultCycleDays}::numeric as cycle_days,
						${inputs.fuelBlockPriceOverride}::numeric as fuel_override,
						${inputs.magmaticGasPriceOverride}::numeric as gas_override
				), pricing_profiles as (
					select * from jsonb_to_recordset(${JSON.stringify(profileRows)}::jsonb) as p(
						id text, base_volume_per_hr numeric, rig_bonus numeric, fuel_per_hr numeric,
						magmatic_gas_per_hr numeric, nullsec_modifier numeric, is_passive boolean
					)
				), pricing_materials as (
					select * from jsonb_to_recordset(${JSON.stringify(materialRows)}::jsonb) as m(
						ore_type_id text, material_type_id text, quantity numeric, ore_volume numeric
					)
				), pricing_prices as (
					select * from jsonb_to_recordset(${JSON.stringify(priceRows)}::jsonb) as p(
						type_id text, price numeric
					)
				), gross_values as (
					select vc.moon_id, p.id as structure_type,
						sum(
							floor(
								floor(
									(
										p.base_volume_per_hr * (1 + p.rig_bonus) * s.cycle_days * 24 *
										case when p.is_passive then p.nullsec_modifier else 1 end *
										o.quantity::numeric / m.ore_volume / 100
										) * m.quantity * s.reprocessing_yield
								) * coalesce(pr.price, 0)
						)) as gross_isk
					from ${verifiedCompositions} vc
					join ${moonScanOres} o on o.scan_id = vc.source_scan_id
					join pricing_materials m on m.ore_type_id = o.ore_type_id
					cross join pricing_profiles p
					cross join pricing_settings s
					left join pricing_prices pr on pr.type_id = m.material_type_id
					where not (p.is_passive and m.material_type_id in ('35', '36'))
					group by vc.moon_id, p.id
				), profit_values as (
					select
						g.moon_id,
						g.structure_type,
						round(
							g.gross_isk -
							(
								p.fuel_per_hr * s.cycle_days * 24 *
								case when s.fuel_override > 0 then s.fuel_override else coalesce(fuel.price, 0) end
							) -
							(
								case when p.is_passive then coalesce(p.magmatic_gas_per_hr, 0) * s.cycle_days * 24 else 0 end *
								case when s.gas_override > 0 then s.gas_override else coalesce(gas.price, 0) end
							)
						) as profit
					from gross_values g
					join pricing_profiles p on p.id = g.structure_type
					cross join pricing_settings s
					left join pricing_prices fuel on fuel.type_id = ${FUEL_BLOCK_TYPE_ID}
					left join pricing_prices gas on gas.type_id = ${MAGMATIC_GAS_TYPE_ID}
				)
				select
					s.moon_id as moon_id,
					s.moon_name as moon_name,
					s.solar_system_id as solar_system_id,
					s.solar_system_name as solar_system_name,
					s.region_id as region_id,
					s.region_name as region_name,
					s.constellation_id as constellation_id,
					s.constellation_name as constellation_name,
					s.security_status as security_status,
					s.highest_rarity as highest_rarity,
					case s.highest_rarity when 'R4' then 1 when 'R8' then 2 when 'R16' then 3 when 'R32' then 4 when 'R64' then 5 else -1 end as rarity_order,
					case when s.security_status ~ '^[+-]?[0-9]+([.][0-9]+)?$' then s.security_status::double precision else null end as security_status_value,
					max(case when pv.structure_type = 'metenox' then pv.profit end) as metenox_profit,
					max(case when pv.structure_type = 'tatara' then pv.profit end) as tatara_profit
				from ${verifiedMoonSummaries} s
				left join profit_values pv on pv.moon_id = s.moon_id
				${rawWhere}
				group by s.moon_id, s.moon_name, s.solar_system_id, s.solar_system_name, s.region_id,
					s.region_name, s.constellation_id, s.constellation_name, s.security_status, s.highest_rarity
				order by ${orderSql}
				limit ${filters.pageSize} offset ${offset}
			`
			const rows = await this.db.execute(pricingSql)
			return {
				items: rows.rows.map((row) => ({
					moonId: String(row.moon_id),
					moonName: String(row.moon_name),
					solarSystemId: String(row.solar_system_id),
					solarSystemName: String(row.solar_system_name),
					regionId: String(row.region_id),
					regionName: String(row.region_name),
					constellationId: String(row.constellation_id),
					constellationName: String(row.constellation_name),
					securityStatus: row.security_status == null ? null : String(row.security_status),
					highestRarity: row.highest_rarity as OreRarity | null,
					metenoxProfit: row.metenox_profit == null ? null : String(row.metenox_profit),
					tataraProfit: row.tatara_profit == null ? null : String(row.tatara_profit),
				})),
				total,
				page: filters.page,
				pageSize: filters.pageSize,
				constellations: constellations.map((row) => ({
					constellationId: row.constellationId,
					constellationName: row.constellationName,
				})),
			}
		}

		const rarityOrderExpr = sql<number>`case ${verifiedMoonSummaries.highestRarity}
			when 'R4' then 1
			when 'R8' then 2
			when 'R16' then 3
			when 'R32' then 4
			when 'R64' then 5
			else -1
		end`
		const securityStatusExpr = sql<number>`case
			when ${verifiedMoonSummaries.securityStatus} is null then null
			else ${verifiedMoonSummaries.securityStatus}::double precision
		end`
		const direction = filters.sortDir === 'asc' ? asc : desc
		const orderByColumns = (() => {
			switch (filters.sortBy) {
				case 'solarSystemName':
					return [direction(verifiedMoonSummaries.solarSystemName)]
				case 'regionName':
					return [direction(verifiedMoonSummaries.regionName)]
				case 'securityStatus':
					return [direction(securityStatusExpr)]
				case 'highestRarity':
					return [direction(rarityOrderExpr)]
				case 'moonName':
				default:
					return [direction(verifiedMoonSummaries.moonName)]
			}
		})()

		const rows = await this.db
			.select({
				moonId: verifiedMoonSummaries.moonId,
				moonName: verifiedMoonSummaries.moonName,
				solarSystemId: verifiedMoonSummaries.solarSystemId,
				solarSystemName: verifiedMoonSummaries.solarSystemName,
				regionId: verifiedMoonSummaries.regionId,
				regionName: verifiedMoonSummaries.regionName,
				constellationId: verifiedMoonSummaries.constellationId,
				constellationName: verifiedMoonSummaries.constellationName,
				securityStatus: verifiedMoonSummaries.securityStatus,
				highestRarity: verifiedMoonSummaries.highestRarity,
			})
			.from(verifiedMoonSummaries)
			.where(where)
			.orderBy(
				...orderByColumns,
				asc(verifiedMoonSummaries.moonName),
				asc(verifiedMoonSummaries.moonId)
			)
			.limit(filters.pageSize)
			.offset(offset)

		return {
			items: rows.map((row) => ({
				moonId: row.moonId,
				moonName: row.moonName,
				solarSystemId: row.solarSystemId,
				solarSystemName: row.solarSystemName,
				regionId: row.regionId,
				regionName: row.regionName,
				constellationId: row.constellationId,
				constellationName: row.constellationName,
				securityStatus: row.securityStatus,
				highestRarity: row.highestRarity as OreRarity | null,
			})),
			total,
			page: filters.page,
			pageSize: filters.pageSize,
			constellations: constellations.map((row) => ({
				constellationId: row.constellationId,
				constellationName: row.constellationName,
			})),
		}
	}

	async getVerifiedMoonCountsByRegionIds(regionIds: string[]): Promise<VerifiedMoonRegionCount[]> {
		const uniqueRegionIds = [...new Set(regionIds)]
		if (uniqueRegionIds.length === 0) return []

		const rows = await this.db
			.select({
				regionId: verifiedMoonSummaries.regionId,
				verifiedCount: count(verifiedMoonSummaries.moonId),
			})
			.from(verifiedMoonSummaries)
			.where(inArray(verifiedMoonSummaries.regionId, uniqueRegionIds))
			.groupBy(verifiedMoonSummaries.regionId)

		return rows.map((row) => ({
			regionId: row.regionId,
			verifiedCount: Number(row.verifiedCount),
		}))
	}

	async getVerifiedMoonSummaryIds(): Promise<string[]> {
		const rows = await this.db
			.select({ moonId: verifiedMoonSummaries.moonId })
			.from(verifiedMoonSummaries)
		return rows.map((row) => row.moonId)
	}

	async upsertVerifiedMoonSummaries(summaries: VerifiedMoonSummaryRecord[]): Promise<void> {
		if (summaries.length === 0) return

		await this.db
			.insert(verifiedMoonSummaries)
			.values(
				summaries.map((summary) => ({
					...summary,
					verifiedAt: new Date(summary.verifiedAt),
				}))
			)
			.onConflictDoUpdate({
				target: verifiedMoonSummaries.moonId,
				set: {
					sourceScanId: sql`excluded.source_scan_id`,
					verifiedAt: sql`excluded.verified_at`,
					verifiedBy: sql`excluded.verified_by`,
					moonName: sql`excluded.moon_name`,
					solarSystemId: sql`excluded.solar_system_id`,
					solarSystemName: sql`excluded.solar_system_name`,
					regionId: sql`excluded.region_id`,
					regionName: sql`excluded.region_name`,
					constellationId: sql`excluded.constellation_id`,
					constellationName: sql`excluded.constellation_name`,
					securityStatus: sql`excluded.security_status`,
					highestRarity: sql`excluded.highest_rarity`,
				},
			})
	}

	async getLeaderboard(window: LeaderboardWindow): Promise<LeaderboardEntry[]> {
		const windowFilter =
			window === 'all'
				? undefined
				: window === '7d'
					? gte(moonScans.submittedAt, sql`now() - interval '7 days'`)
					: gte(moonScans.submittedAt, sql`now() - interval '30 days'`)

		// Count verified scans per submitter (join on sourceScanId)
		const conditions = [isNotNull(moonScans.submittedBy), isNotNull(verifiedCompositions.moonId)]
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

		const characterIds = rows.map((r) => r.characterId).filter((id): id is string => id !== null)

		const names =
			characterIds.length > 0
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

	async getScannedMoonCountsByRegionIds(regionIds: string[]): Promise<ScannedMoonRegionCount[]> {
		const uniqueRegionIds = [...new Set(regionIds)]
		if (uniqueRegionIds.length === 0) return []

		const rows = await this.db
			.select({
				regionId: moonScans.regionId,
				scannedCount: sql<number>`count(distinct ${moonScans.moonId})`,
			})
			.from(moonScans)
			.where(and(isNotNull(moonScans.regionId), inArray(moonScans.regionId, uniqueRegionIds)))
			.groupBy(moonScans.regionId)

		return rows.map((row) => ({
			regionId: row.regionId as string,
			scannedCount: Number(row.scannedCount),
		}))
	}

	async getUnlocatedScannedMoonIds(limit: number, afterMoonId?: string): Promise<string[]> {
		const conditions = [isNull(moonScans.regionId)]
		if (afterMoonId) conditions.push(sql`${moonScans.moonId} > ${afterMoonId}`)

		const rows = await this.db
			.selectDistinct({ moonId: moonScans.moonId })
			.from(moonScans)
			.where(and(...conditions))
			.orderBy(asc(moonScans.moonId))
			.limit(Math.min(Math.max(limit, 1), 500))

		return rows.map((row) => row.moonId)
	}

	async backfillScanLocations(locations: ScanLocation[]): Promise<void> {
		const grouped = new Map<string, string[]>()
		for (const location of locations) {
			const key = `${location.regionId}:${location.solarSystemId}`
			const moonIds = grouped.get(key) ?? []
			moonIds.push(location.moonId)
			grouped.set(key, moonIds)
		}

		for (const [key, moonIds] of grouped) {
			const separator = key.indexOf(':')
			const regionId = key.slice(0, separator)
			const solarSystemId = key.slice(separator + 1)
			await this.db
				.update(moonScans)
				.set({ regionId, solarSystemId })
				.where(and(isNull(moonScans.regionId), inArray(moonScans.moonId, moonIds)))
		}
	}

	async getMoonCoverage(moonIds: string[]): Promise<MoonCoverageStat[]> {
		if (moonIds.length === 0) return []

		const uniqueMoonIds = [...new Set(moonIds)]
		const scannedMoonIds: Array<{ moonId: string }> = []
		const verifiedMoonIds: Array<{ moonId: string }> = []
		for (const moonIdChunk of chunkArray(uniqueMoonIds, BATCH_SIZE)) {
			const [scannedRows, verifiedRows] = await Promise.all([
				this.db
					.selectDistinct({ moonId: moonScans.moonId })
					.from(moonScans)
					.where(inArray(moonScans.moonId, moonIdChunk)),
				this.db
					.select({ moonId: verifiedCompositions.moonId })
					.from(verifiedCompositions)
					.where(inArray(verifiedCompositions.moonId, moonIdChunk)),
			])
			scannedMoonIds.push(...scannedRows)
			verifiedMoonIds.push(...verifiedRows)
		}

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

	async updateExtractionSettings(
		settings: Partial<ExtractionSettings>
	): Promise<ExtractionSettings> {
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

	async updateStructureProfile(
		id: StructureType,
		profile: Partial<StructureProfile>
	): Promise<StructureProfile> {
		const [updated] = await this.db
			.update(structureProfiles)
			.set({
				...(profile.baseVolumePerHr !== undefined && { baseVolumePerHr: profile.baseVolumePerHr }),
				...(profile.rigBonus !== undefined && { rigBonus: profile.rigBonus }),
				...(profile.fuelPerHr !== undefined && { fuelPerHr: profile.fuelPerHr }),
				...(profile.magmaticGasPerHr !== undefined && {
					magmaticGasPerHr: profile.magmaticGasPerHr,
				}),
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
			regionId: row.regionId,
			solarSystemId: row.solarSystemId,
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
