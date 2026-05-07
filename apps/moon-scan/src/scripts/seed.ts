import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'

import { drizzle } from 'drizzle-orm/neon-http'
import { neon } from '@neondatabase/serverless'

import { extractionSettings, structureProfiles } from '../db/schema'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '../../../../.env') })

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
