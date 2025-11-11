import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'
import { neon } from '@neondatabase/serverless'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '../../../../.env') })

async function main() {
	const sql = neon(process.env.DATABASE_URL_MIGRATIONS!)

	const fks = await sql`
		SELECT
			conname AS constraint_name,
			conrelid::regclass AS table_name
		FROM pg_constraint
		WHERE contype = 'f'
			AND conrelid::regclass::text LIKE 'character_%'
		ORDER BY table_name, constraint_name
	`

	console.log('Foreign key constraints on character_* tables:')
	for (const fk of fks) {
		console.log(`${fk.table_name}: ${fk.constraint_name}`)
	}
}

main().catch(console.error)
