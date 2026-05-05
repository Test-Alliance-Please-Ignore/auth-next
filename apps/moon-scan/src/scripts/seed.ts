import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'

import { createDbClientRaw } from '@repo/db-utils'
import { drizzle } from 'drizzle-orm/neon-http'
import { neon } from '@neondatabase/serverless'

import {
	extractionSettings,
	moonScanStatusEnum,
	moonScanSourceEnum,
	oreRarities,
	structureProfiles,
} from '../db/schema'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '../../../../.env') })

const ORE_RARITIES = [
	// R4
	{ oreTypeId: '45490', rarity: 'R4', color: '#8a8a8a' },
	{ oreTypeId: '45491', rarity: 'R4', color: '#8a8a8a' },
	{ oreTypeId: '45492', rarity: 'R4', color: '#8a8a8a' },
	{ oreTypeId: '45493', rarity: 'R4', color: '#8a8a8a' },
	// R8
	{ oreTypeId: '45494', rarity: 'R8', color: '#4e9e4e' },
	{ oreTypeId: '45495', rarity: 'R8', color: '#4e9e4e' },
	{ oreTypeId: '45496', rarity: 'R8', color: '#4e9e4e' },
	{ oreTypeId: '45497', rarity: 'R8', color: '#4e9e4e' },
	// R16
	{ oreTypeId: '45498', rarity: 'R16', color: '#4e7bc4' },
	{ oreTypeId: '45499', rarity: 'R16', color: '#4e7bc4' },
	{ oreTypeId: '45500', rarity: 'R16', color: '#4e7bc4' },
	{ oreTypeId: '45501', rarity: 'R16', color: '#4e7bc4' },
	// R32
	{ oreTypeId: '45502', rarity: 'R32', color: '#9b4ec4' },
	{ oreTypeId: '45503', rarity: 'R32', color: '#9b4ec4' },
	{ oreTypeId: '45504', rarity: 'R32', color: '#9b4ec4' },
	{ oreTypeId: '45506', rarity: 'R32', color: '#9b4ec4' },
	// R64
	{ oreTypeId: '45510', rarity: 'R64', color: '#c4a020' },
	{ oreTypeId: '45511', rarity: 'R64', color: '#c4a020' },
	{ oreTypeId: '45512', rarity: 'R64', color: '#c4a020' },
	{ oreTypeId: '45513', rarity: 'R64', color: '#c4a020' },
] as const

const STRUCTURE_PROFILES = [
	{
		id: 'tatara',
		baseVolumePerHr: '14000',
		rigBonus: '0.04',
		fuelPerHr: '10',
		magmaticGasPerHr: null,
		minCycleDays: 28,
		maxCycleDays: 35,
		isPassive: false,
		lowsecModifier: '0.5',
		nullsecModifier: '1.0',
	},
	{
		id: 'metenox',
		baseVolumePerHr: '2800',
		rigBonus: '0.00',
		fuelPerHr: '5',
		magmaticGasPerHr: '20',
		minCycleDays: null,
		maxCycleDays: null,
		isPassive: true,
		lowsecModifier: '0.5',
		nullsecModifier: '1.0',
	},
] as const

async function main() {
	const databaseUrl = process.env.DATABASE_URL_MIGRATIONS
	if (!databaseUrl) throw new Error('DATABASE_URL_MIGRATIONS is required')

	const sql = neon(databaseUrl)
	const db = drizzle(sql)

	console.log('Seeding ore rarities...')
	await db
		.insert(oreRarities)
		.values(ORE_RARITIES.map((o) => ({ ...o })))
		.onConflictDoNothing()

	console.log('Seeding structure profiles...')
	await db
		.insert(structureProfiles)
		.values(STRUCTURE_PROFILES.map((p) => ({ ...p })))
		.onConflictDoNothing()

	console.log('Seeding extraction settings...')
	await db
		.insert(extractionSettings)
		.values({
			id: 'default',
			defaultReprocessingYield: '0.80',
			defaultCycleDays: 30,
			fuelBlockPriceOverride: null,
			magmaticGasPriceOverride: null,
		})
		.onConflictDoNothing()

	console.log('Seed completed!')
	process.exit(0)
}

main().catch((err) => {
	console.error('Seed failed:', err)
	process.exit(1)
})
