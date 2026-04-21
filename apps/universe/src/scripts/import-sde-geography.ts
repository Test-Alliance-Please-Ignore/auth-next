import { createReadStream } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'
import { eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'

import { createDb } from '../db'
import {
	moons,
	universeConstellations,
	universeNpcStations,
	universePlanets,
	universeRegions,
	universeSolarSystems,
	universeStargates,
} from '../db/schema'
import {
	getEnglishName,
	prepareSdeDataDir,
	readSdeJsonlTable,
	readSdeMetadata,
	toBoolean,
} from './sde-jsonl'

import type { SdeMetadata } from './sde-jsonl'

// Load .env from monorepo root
const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '../../../../.env') })

const localizedTextSchema = z.record(z.string(), z.string())

const regionSchema = z.object({
	_key: z.number(),
	name: z.union([z.string(), localizedTextSchema]),
})

const constellationSchema = z.object({
	_key: z.number(),
	name: z.union([z.string(), localizedTextSchema]),
	regionID: z.number(),
})

const solarSystemSchema = z.object({
	_key: z.number(),
	name: z.union([z.string(), localizedTextSchema]),
	regionID: z.number(),
	constellationID: z.number(),
	securityStatus: z.number().nullable().optional(),
})

const planetSchema = z.object({
	_key: z.number(),
	solarSystemID: z.number(),
	celestialIndex: z.number().nullable().optional(),
	typeID: z.number().nullable().optional(),
})

const moonSchema = z.object({
	_key: z.number(),
	solarSystemID: z.number(),
	orbitID: z.number().nullable().optional(),
	orbitIndex: z.number().nullable().optional(),
	celestialIndex: z.number().nullable().optional(),
})

const stargateSchema = z.object({
	_key: z.number(),
	solarSystemID: z.number(),
	destination: z
		.object({
			solarSystemID: z.number().nullable().optional(),
			stargateID: z.number().nullable().optional(),
		})
		.nullable()
		.optional(),
	typeID: z.number().nullable().optional(),
})

const npcStationSchema = z.object({
	_key: z.number(),
	solarSystemID: z.number(),
	orbitID: z.number().nullable().optional(),
	ownerID: z.number().nullable().optional(),
	operationID: z.number().nullable().optional(),
	typeID: z.number().nullable().optional(),
	useOperationName: z.union([z.number(), z.boolean()]).optional(),
})

const npcCorporationSchema = z.object({
	_key: z.number(),
	name: z.union([z.string(), localizedTextSchema]),
})

const stationOperationSchema = z.object({
	_key: z.number(),
	operationName: z.union([z.string(), localizedTextSchema]),
})

const PROGRESS_INTERVAL = 5000

function toRoman(value: number): string {
	if (!Number.isFinite(value) || value <= 0) {
		return ''
	}

	const numerals: Array<{ value: number; symbol: string }> = [
		{ value: 1000, symbol: 'M' },
		{ value: 900, symbol: 'CM' },
		{ value: 500, symbol: 'D' },
		{ value: 400, symbol: 'CD' },
		{ value: 100, symbol: 'C' },
		{ value: 90, symbol: 'XC' },
		{ value: 50, symbol: 'L' },
		{ value: 40, symbol: 'XL' },
		{ value: 10, symbol: 'X' },
		{ value: 9, symbol: 'IX' },
		{ value: 5, symbol: 'V' },
		{ value: 4, symbol: 'IV' },
		{ value: 1, symbol: 'I' },
	]

	let remainder = Math.floor(value)
	let result = ''

	for (const numeral of numerals) {
		while (remainder >= numeral.value) {
			result += numeral.symbol
			remainder -= numeral.value
		}
	}

	return result
}

function createProgressReporter(typeLabel: string, total?: number): (processed: number) => void {
	let nextProgressAt = PROGRESS_INTERVAL
	return (processed: number) => {
		while (processed >= nextProgressAt) {
			if (typeof total === 'number') {
				console.log(`  ... ${typeLabel}: ${Math.min(processed, total)}/${total}`)
			} else {
				console.log(`  ... ${typeLabel}: ${processed}`)
			}
			nextProgressAt += PROGRESS_INTERVAL
		}
	}
}

async function streamJsonl<T>(
	filePath: string,
	onEntry: (entry: T) => Promise<void> | void
): Promise<void> {
	const input = createReadStream(filePath, { encoding: 'utf-8' })
	const rl = createInterface({ input, crlfDelay: Infinity })

	for await (const line of rl) {
		const trimmed = line.trim()
		if (!trimmed) {
			continue
		}

		const parsed = JSON.parse(trimmed) as T
		await onEntry(parsed)
	}
}

async function importRegions(db: ReturnType<typeof createDb>, sdeDataDir: string): Promise<void> {
	console.log('Importing regions...')
	const raw = await readSdeJsonlTable<z.input<typeof regionSchema>>(sdeDataDir, 'mapRegions.jsonl')
	const regions = raw.map((entry) => regionSchema.parse(entry))

	const rows = regions.map((region) => {
		const regionId = region._key.toString()
		return {
			regionId,
			regionName: getEnglishName(region.name, `Unknown Region (${regionId})`),
		}
	})

	const reportProgress = createProgressReporter('regions', rows.length)
	const BATCH_SIZE = 1000
	let processed = 0
	for (let i = 0; i < rows.length; i += BATCH_SIZE) {
		const batch = rows.slice(i, i + BATCH_SIZE)
		await db
			.insert(universeRegions)
			.values(batch)
			.onConflictDoUpdate({
				target: universeRegions.regionId,
				set: {
					regionName: sql`excluded.region_name`,
				},
			})
		processed += batch.length
		reportProgress(processed)
	}

	console.log(`  ✓ ${rows.length} regions`)
}

async function importConstellations(
	db: ReturnType<typeof createDb>,
	sdeDataDir: string
): Promise<void> {
	console.log('Importing constellations...')
	const raw = await readSdeJsonlTable<z.input<typeof constellationSchema>>(
		sdeDataDir,
		'mapConstellations.jsonl'
	)
	const constellations = raw.map((entry) => constellationSchema.parse(entry))

	const rows = constellations.map((c) => {
		const constellationId = c._key.toString()
		return {
			constellationId,
			constellationName: getEnglishName(c.name, `Unknown Constellation (${constellationId})`),
			regionId: c.regionID.toString(),
		}
	})

	const reportProgress = createProgressReporter('constellations', rows.length)
	const BATCH_SIZE = 1000
	let processed = 0
	for (let i = 0; i < rows.length; i += BATCH_SIZE) {
		const batch = rows.slice(i, i + BATCH_SIZE)
		await db
			.insert(universeConstellations)
			.values(batch)
			.onConflictDoUpdate({
				target: universeConstellations.constellationId,
				set: {
					constellationName: sql`excluded.constellation_name`,
					regionId: sql`excluded.region_id`,
				},
			})
		processed += batch.length
		reportProgress(processed)
	}

	console.log(`  ✓ ${rows.length} constellations`)
}

async function importSolarSystems(
	db: ReturnType<typeof createDb>,
	sdeDataDir: string
): Promise<Map<string, string>> {
	console.log('Importing solar systems...')
	const raw = await readSdeJsonlTable<z.input<typeof solarSystemSchema>>(
		sdeDataDir,
		'mapSolarSystems.jsonl'
	)
	const solarSystems = raw.map((entry) => solarSystemSchema.parse(entry))
	const systemNameById = new Map<string, string>()
	const rows = solarSystems.map((system) => {
		const solarSystemId = system._key.toString()
		const solarSystemName = getEnglishName(system.name, `Unknown System (${solarSystemId})`)
		systemNameById.set(solarSystemId, solarSystemName)
		return {
			solarSystemId,
			solarSystemName,
			regionId: system.regionID.toString(),
			constellationId: system.constellationID.toString(),
			securityStatus: system.securityStatus == null ? null : system.securityStatus.toString(),
		}
	})

	const reportProgress = createProgressReporter('solar systems', rows.length)
	const BATCH_SIZE = 1000
	let processed = 0
	for (let i = 0; i < rows.length; i += BATCH_SIZE) {
		const batch = rows.slice(i, i + BATCH_SIZE)
		await db
			.insert(universeSolarSystems)
			.values(batch)
			.onConflictDoUpdate({
				target: universeSolarSystems.solarSystemId,
				set: {
					solarSystemName: sql`excluded.solar_system_name`,
					regionId: sql`excluded.region_id`,
					constellationId: sql`excluded.constellation_id`,
					securityStatus: sql`excluded.security_status`,
				},
			})
		processed += batch.length
		reportProgress(processed)
	}

	console.log(`  ✓ ${rows.length} solar systems`)
	return systemNameById
}

async function importPlanets(
	db: ReturnType<typeof createDb>,
	sdeDataDir: string,
	systemNameById: Map<string, string>,
	stationOrbitIds: Set<string>,
	orbitNameById: Map<string, string>
): Promise<Map<string, string>> {
	console.log('Importing planets...')

	const planetNameById = new Map<string, string>()
	const BATCH_SIZE = 2000
	let batch: Array<typeof universePlanets.$inferInsert> = []
	let processed = 0
	let invalid = 0
	const reportProgress = createProgressReporter('planets')

	const flush = async () => {
		if (batch.length === 0) return
		await db
			.insert(universePlanets)
			.values(batch)
			.onConflictDoUpdate({
				target: universePlanets.planetId,
				set: {
					planetName: sql`excluded.planet_name`,
					solarSystemId: sql`excluded.solar_system_id`,
					celestialIndex: sql`excluded.celestial_index`,
					typeId: sql`excluded.type_id`,
				},
			})
		batch = []
	}

	await streamJsonl<unknown>(join(sdeDataDir, 'mapPlanets.jsonl'), async (entry) => {
		const parsed = planetSchema.safeParse(entry)
		if (!parsed.success) {
			invalid++
			return
		}

		const planet = parsed.data
		const planetId = planet._key.toString()
		const solarSystemId = planet.solarSystemID.toString()
		const celestialIndex = planet.celestialIndex ?? 0
		const systemName = systemNameById.get(solarSystemId) ?? `Unknown System (${solarSystemId})`
		const romanIndex = toRoman(celestialIndex)
		const planetName =
			romanIndex.length > 0 ? `${systemName} ${romanIndex}` : `${systemName} Planet (${planetId})`

		planetNameById.set(planetId, planetName)
		if (stationOrbitIds.has(planetId)) {
			orbitNameById.set(planetId, planetName)
		}

		batch.push({
			planetId,
			planetName,
			solarSystemId,
			celestialIndex,
			typeId: planet.typeID?.toString() ?? null,
		})
		processed++
		reportProgress(processed)

		if (batch.length >= BATCH_SIZE) {
			await flush()
		}
	})

	await flush()
	console.log(`  ✓ ${processed} planets${invalid > 0 ? ` (${invalid} skipped)` : ''}`)
	return planetNameById
}

async function importMoons(
	db: ReturnType<typeof createDb>,
	sdeDataDir: string,
	planetNameById: Map<string, string>,
	stationOrbitIds: Set<string>,
	orbitNameById: Map<string, string>
): Promise<void> {
	console.log('Importing moons...')

	const BATCH_SIZE = 3000
	let batch: Array<typeof moons.$inferInsert> = []
	let processed = 0
	let invalid = 0
	let nameConflictsResolved = 0
	const nameConflictKeys = new Set<string>()
	const nameConflicts: Array<{
		name: string
		existingMoonId: string
		incomingMoonId: string
		source: 'existing_db' | 'same_import'
	}> = []
	const reportProgress = createProgressReporter('moons')
	const existingMoonNameToId = new Map<string, string>()
	const seenMoonNameToId = new Map<string, string>()

	const existingMoonRows = await db
		.select({ name: moons.name, moonId: moons.moonId })
		.from(moons)
	for (const row of existingMoonRows) {
		existingMoonNameToId.set(row.name, row.moonId)
		seenMoonNameToId.set(row.name, row.moonId)
	}

	const flush = async () => {
		if (batch.length === 0) return
		await db
			.insert(moons)
			.values(batch)
			.onConflictDoUpdate({
				target: moons.moonId,
				set: {
					name: sql`excluded.name`,
					planetId: sql`excluded.planet_id`,
					solarSystemId: sql`excluded.solar_system_id`,
					updatedAt: sql`now()`,
				},
			})
		batch = []
	}

	await streamJsonl<unknown>(join(sdeDataDir, 'mapMoons.jsonl'), async (entry) => {
		const parsed = moonSchema.safeParse(entry)
		if (!parsed.success) {
			invalid++
			return
		}

		const moon = parsed.data
		const moonId = moon._key.toString()
		const solarSystemId = moon.solarSystemID.toString()
		const planetId = moon.orbitID?.toString() ?? ''
		const planetName = planetNameById.get(planetId) ?? `Unknown Planet (${planetId || 'n/a'})`
		const moonIndex = moon.orbitIndex ?? moon.celestialIndex ?? 0
		const moonName =
			moonIndex > 0 ? `${planetName} - Moon ${moonIndex}` : `${planetName} - Moon (${moonId})`

		const seenMoonId = seenMoonNameToId.get(moonName)
		if (seenMoonId && seenMoonId !== moonId) {
			nameConflictsResolved++
			const source = existingMoonNameToId.has(moonName) ? 'existing_db' : 'same_import'
			const conflictKey = `${moonName}|${seenMoonId}|${moonId}|${source}`
			if (!nameConflictKeys.has(conflictKey)) {
				nameConflictKeys.add(conflictKey)
				nameConflicts.push({
					name: moonName,
					existingMoonId: seenMoonId,
					incomingMoonId: moonId,
					source,
					})
				}

			// Replace policy: old entry is considered stale; remove it and keep incoming.
			await db.delete(moons).where(eq(moons.moonId, seenMoonId)).catch(() => {})
			const existingIndex = batch.findIndex((row) => row.name === moonName)
			if (existingIndex >= 0) {
				batch.splice(existingIndex, 1)
			}
			existingMoonNameToId.delete(moonName)
		}
		seenMoonNameToId.set(moonName, moonId)

		if (stationOrbitIds.has(moonId)) {
			orbitNameById.set(moonId, moonName)
		}

		batch.push({
			name: moonName,
			moonId,
			planetId,
			solarSystemId,
		})
		processed++
		reportProgress(processed)

		if (batch.length >= BATCH_SIZE) {
			await flush()
		}
	})

	await flush()
	const skippedNotes: string[] = []
	if (invalid > 0) skippedNotes.push(`${invalid} invalid`)
	if (nameConflictsResolved > 0) skippedNotes.push(`${nameConflictsResolved} name conflicts resolved`)
	console.log(
		`  ✓ ${processed} moons${skippedNotes.length > 0 ? ` (${skippedNotes.join(', ')})` : ''}`
	)
	if (nameConflicts.length > 0) {
		console.log(`  ! Moon name conflicts encountered (${nameConflicts.length}):`)
		for (const conflict of nameConflicts) {
			console.log(
				`    - ${conflict.name} :: existing=${conflict.existingMoonId} incoming=${conflict.incomingMoonId} source=${conflict.source}`
			)
		}
	}
}

async function importStargates(
	db: ReturnType<typeof createDb>,
	sdeDataDir: string,
	systemNameById: Map<string, string>
): Promise<void> {
	console.log('Importing stargates...')

	const BATCH_SIZE = 2000
	let batch: Array<typeof universeStargates.$inferInsert> = []
	let processed = 0
	let invalid = 0
	const reportProgress = createProgressReporter('stargates')

	const flush = async () => {
		if (batch.length === 0) return
		await db
			.insert(universeStargates)
			.values(batch)
			.onConflictDoUpdate({
				target: universeStargates.stargateId,
				set: {
					stargateName: sql`excluded.stargate_name`,
					solarSystemId: sql`excluded.solar_system_id`,
					destinationSolarSystemId: sql`excluded.destination_solar_system_id`,
					destinationStargateId: sql`excluded.destination_stargate_id`,
					typeId: sql`excluded.type_id`,
				},
			})
		batch = []
	}

	await streamJsonl<unknown>(join(sdeDataDir, 'mapStargates.jsonl'), async (entry) => {
		const parsed = stargateSchema.safeParse(entry)
		if (!parsed.success) {
			invalid++
			return
		}

		const stargate = parsed.data
		const stargateId = stargate._key.toString()
		const solarSystemId = stargate.solarSystemID.toString()
		const destinationSolarSystemId = stargate.destination?.solarSystemID?.toString() ?? null
		const destinationStargateId = stargate.destination?.stargateID?.toString() ?? null
		const sourceName = systemNameById.get(solarSystemId) ?? `Unknown System (${solarSystemId})`
		const destinationName = destinationSolarSystemId
			? (systemNameById.get(destinationSolarSystemId) ??
				`Unknown System (${destinationSolarSystemId})`)
			: 'Unknown Destination'
		const stargateName = `${sourceName} -> ${destinationName} Stargate`

		batch.push({
			stargateId,
			stargateName,
			solarSystemId,
			destinationSolarSystemId,
			destinationStargateId,
			typeId: stargate.typeID?.toString() ?? null,
		})
		processed++
		reportProgress(processed)

		if (batch.length >= BATCH_SIZE) {
			await flush()
		}
	})

	await flush()
	console.log(`  ✓ ${processed} stargates${invalid > 0 ? ` (${invalid} skipped)` : ''}`)
}

function buildStationName(
	orbitName: string,
	corporationName: string,
	operationName: string,
	useOperationName: boolean
): string {
	if (useOperationName) {
		return `${orbitName} - ${corporationName} ${operationName}`.trim()
	}

	return `${orbitName} - ${corporationName}`.trim()
}

async function importNpcStations(
	db: ReturnType<typeof createDb>,
	npcStationsData: Array<z.output<typeof npcStationSchema>>,
	systemNameById: Map<string, string>,
	orbitNameById: Map<string, string>,
	corporationNameById: Map<string, string>,
	operationNameById: Map<string, string>
): Promise<void> {
	console.log('Importing NPC stations...')

	const rows = npcStationsData.map((station) => {
		const stationId = station._key.toString()
		const solarSystemId = station.solarSystemID.toString()
		const orbitId = station.orbitID?.toString() ?? null
		const ownerId = station.ownerID?.toString() ?? null
		const operationId = station.operationID?.toString() ?? null
		const useOperationName = toBoolean(station.useOperationName)

		const defaultOrbitName =
			systemNameById.get(solarSystemId) ?? `Unknown System (${solarSystemId})`
		const orbitName =
			(orbitId ? orbitNameById.get(orbitId) : null) ??
			(orbitId ? `Unknown Orbit (${orbitId})` : defaultOrbitName)
		const corporationName =
			(ownerId ? corporationNameById.get(ownerId) : null) ??
			(ownerId ? `Corporation ${ownerId}` : 'Unknown Corporation')
		const operationName =
			(operationId ? operationNameById.get(operationId) : null) ??
			(operationId ? `Operation ${operationId}` : 'Station')
		const stationName = buildStationName(
			orbitName,
			corporationName,
			operationName,
			useOperationName
		)

		return {
			stationId,
			stationName,
			solarSystemId,
			orbitId,
			ownerId,
			operationId,
			typeId: station.typeID?.toString() ?? null,
			useOperationName,
		}
	})

	const reportProgress = createProgressReporter('NPC stations', rows.length)
	const BATCH_SIZE = 1000
	let processed = 0
	for (let i = 0; i < rows.length; i += BATCH_SIZE) {
		const batch = rows.slice(i, i + BATCH_SIZE)
		await db
			.insert(universeNpcStations)
			.values(batch)
			.onConflictDoUpdate({
				target: universeNpcStations.stationId,
				set: {
					stationName: sql`excluded.station_name`,
					solarSystemId: sql`excluded.solar_system_id`,
					orbitId: sql`excluded.orbit_id`,
					ownerId: sql`excluded.owner_id`,
					operationId: sql`excluded.operation_id`,
					typeId: sql`excluded.type_id`,
					useOperationName: sql`excluded.use_operation_name`,
				},
			})
		processed += batch.length
		reportProgress(processed)
	}

	console.log(`  ✓ ${rows.length} NPC stations`)
}

async function storeSdeVersion(
	db: ReturnType<typeof createDb>,
	sdeMetadata: SdeMetadata | null
): Promise<void> {
	if (!sdeMetadata) {
		console.warn('  ! Skipping SDE version write: _sde.jsonl metadata missing build/release fields')
		return
	}

	await db.execute(
		sql.raw(`
		create table if not exists "sde_version" (
			"version" text primary key,
			"imported_at" timestamp with time zone not null default now(),
			"checksum" text
		)
	`)
	)
	await db.execute(
		sql.raw(`alter table "sde_version" add column if not exists "build_number" integer`)
	)
	await db.execute(
		sql.raw(
			`alter table "sde_version" add column if not exists "release_date" timestamp with time zone`
		)
	)

	await db.execute(sql`
		insert into "sde_version" ("version", "imported_at", "checksum", "build_number", "release_date")
		values (${sdeMetadata.version}, now(), null, ${sdeMetadata.buildNumber}, ${sdeMetadata.releaseDate})
		on conflict ("version") do update set
			"imported_at" = excluded."imported_at",
			"checksum" = excluded."checksum",
			"build_number" = excluded."build_number",
			"release_date" = excluded."release_date"
	`)

	console.log(
		`  ✓ SDE version recorded: ${sdeMetadata.version}${sdeMetadata.releaseDate ? ` (${sdeMetadata.releaseDate})` : ''}`
	)
}

async function main() {
	const databaseUrl = process.env.DATABASE_URL_MIGRATIONS
	if (!databaseUrl) {
		throw new Error('DATABASE_URL_MIGRATIONS environment variable is required')
	}

	console.log('Starting SDE geography data import...')
	const sdeDataDir = await prepareSdeDataDir()
	const sdeMetadata = await readSdeMetadata(sdeDataDir)
	console.log(`Reading from: ${sdeDataDir}`)

	const db = createDb(databaseUrl)

	// Load the small lookup datasets first.
	const npcStationsRaw = await readSdeJsonlTable<z.input<typeof npcStationSchema>>(
		sdeDataDir,
		'npcStations.jsonl'
	)
	const npcStationsData = npcStationsRaw.map((entry) => npcStationSchema.parse(entry))
	const stationOrbitIds = new Set(
		npcStationsData
			.map((station) => station.orbitID?.toString())
			.filter((id): id is string => !!id && id.length > 0)
	)

	const corporationsRaw = await readSdeJsonlTable<z.input<typeof npcCorporationSchema>>(
		sdeDataDir,
		'npcCorporations.jsonl'
	)
	const corporationNameById = new Map(
		corporationsRaw
			.map((entry) => npcCorporationSchema.parse(entry))
			.map((corp) => [
				corp._key.toString(),
				getEnglishName(corp.name, `Corporation ${corp._key.toString()}`),
			])
	)

	const operationsRaw = await readSdeJsonlTable<z.input<typeof stationOperationSchema>>(
		sdeDataDir,
		'stationOperations.jsonl'
	)
	const operationNameById = new Map(
		operationsRaw
			.map((entry) => stationOperationSchema.parse(entry))
			.map((operation) => [
				operation._key.toString(),
				getEnglishName(operation.operationName, `Operation ${operation._key.toString()}`),
			])
	)

	await importRegions(db, sdeDataDir)
	await importConstellations(db, sdeDataDir)
	const systemNameById = await importSolarSystems(db, sdeDataDir)

	const orbitNameById = new Map<string, string>()
	const planetNameById = await importPlanets(
		db,
		sdeDataDir,
		systemNameById,
		stationOrbitIds,
		orbitNameById
	)
	await importMoons(db, sdeDataDir, planetNameById, stationOrbitIds, orbitNameById)
	await importStargates(db, sdeDataDir, systemNameById)
	await importNpcStations(
		db,
		npcStationsData,
		systemNameById,
		orbitNameById,
		corporationNameById,
		operationNameById
	)

	// Warmup validation query for quick sanity check on inserted geography references.
	const sampleStationOrbitIds = npcStationsData
		.map((station) => station.orbitID?.toString())
		.filter((id): id is string => !!id)
		.slice(0, 200)
	if (sampleStationOrbitIds.length > 0) {
		await db
			.select({ planetId: universePlanets.planetId })
			.from(universePlanets)
			.where(inArray(universePlanets.planetId, sampleStationOrbitIds))
			.limit(1)
	}
	await storeSdeVersion(db, sdeMetadata)

	console.log('✓ SDE geography import complete')
	process.exit(0)
}

main().catch((error) => {
	console.error('✗ Error importing SDE geography:', error)
	process.exit(1)
})
