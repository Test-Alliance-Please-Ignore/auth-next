import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'
import { neon } from '@neondatabase/serverless'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '../../../../.env') })

async function main() {
	const sql = neon(process.env.DATABASE_URL_MIGRATIONS!)

	console.log('=== FOREIGN KEY CONSTRAINTS ===')
	const fks = await sql`
		SELECT
			tc.table_name,
			tc.constraint_name,
			kcu.column_name,
			ccu.table_name AS foreign_table_name,
			ccu.column_name AS foreign_column_name
		FROM information_schema.table_constraints AS tc
		JOIN information_schema.key_column_usage AS kcu
			ON tc.constraint_name = kcu.constraint_name
			AND tc.table_schema = kcu.table_schema
		JOIN information_schema.constraint_column_usage AS ccu
			ON ccu.constraint_name = tc.constraint_name
			AND ccu.table_schema = tc.table_schema
		WHERE tc.constraint_type = 'FOREIGN KEY'
			AND tc.table_name LIKE 'character_%'
		ORDER BY tc.table_name, tc.constraint_name
	`

	for (const fk of fks) {
		console.log(`${fk.table_name}.${fk.column_name} -> ${fk.foreign_table_name}.${fk.foreign_column_name}`)
		console.log(`  Constraint: ${fk.constraint_name}`)
	}

	console.log('\n=== COLUMN TYPES ===')
	const columns = await sql`
		SELECT
			table_name,
			column_name,
			data_type,
			udt_name
		FROM information_schema.columns
		WHERE table_name LIKE 'character_%'
			AND column_name IN ('character_id', 'record_id', 'corporation_id', 'order_id', 'type_id',
				'location_id', 'region_id', 'transaction_id', 'client_id', 'journal_ref_id',
				'alliance_id', 'race_id', 'bloodline_id', 'faction_id', 'journal_id',
				'first_party_id', 'second_party_id', 'tax_receiver_id', 'context_id',
				'solar_system_id', 'station_id')
		ORDER BY table_name, column_name
	`

	for (const col of columns) {
		console.log(`${col.table_name}.${col.column_name}: ${col.data_type} (${col.udt_name})`)
	}

	console.log('\n=== UNIQUE CONSTRAINTS ===')
	const uniques = await sql`
		SELECT
			tc.table_name,
			tc.constraint_name,
			string_agg(kcu.column_name, ', ' ORDER BY kcu.ordinal_position) AS columns
		FROM information_schema.table_constraints tc
		JOIN information_schema.key_column_usage kcu
			ON tc.constraint_name = kcu.constraint_name
			AND tc.table_schema = kcu.table_schema
		WHERE tc.constraint_type = 'UNIQUE'
			AND tc.table_name LIKE 'character_%'
		GROUP BY tc.table_name, tc.constraint_name
		ORDER BY tc.table_name
	`

	for (const u of uniques) {
		console.log(`${u.table_name}: ${u.constraint_name} (${u.columns})`)
	}

	console.log('\n=== PRIMARY KEYS ===')
	const pks = await sql`
		SELECT
			tc.table_name,
			tc.constraint_name,
			string_agg(kcu.column_name, ', ' ORDER BY kcu.ordinal_position) AS columns
		FROM information_schema.table_constraints tc
		JOIN information_schema.key_column_usage kcu
			ON tc.constraint_name = kcu.constraint_name
			AND tc.table_schema = kcu.table_schema
		WHERE tc.constraint_type = 'PRIMARY KEY'
			AND tc.table_name LIKE 'character_%'
		GROUP BY tc.table_name, tc.constraint_name
		ORDER BY tc.table_name
	`

	for (const pk of pks) {
		console.log(`${pk.table_name}: ${pk.constraint_name} (${pk.columns})`)
	}
}

main().catch(console.error)
