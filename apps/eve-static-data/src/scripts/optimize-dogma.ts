/**
 * Optimize the dogma tables for better query performance
 * Run this after importing the SDE dogma data
 */

import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { config } from 'dotenv'
import { sql } from 'drizzle-orm'
import { createDbClient } from '@repo/db-utils'
import { schema } from '../db/schema'

// Load environment variables
config({ path: join(process.cwd(), '.env') })
config({ path: join(process.cwd(), '../../.env') })

async function runOptimizations(db: any) {
	console.log('Running dogma table optimizations...\n')

	try {
		// 1. Increase statistics sampling for better query planning
		console.log('1. Updating statistics configuration...')
		await db.execute(
			sql`ALTER TABLE dgm_type_attributes ALTER COLUMN type_id SET STATISTICS 1000`
		)
		await db.execute(
			sql`ALTER TABLE dgm_type_attributes ALTER COLUMN attribute_id SET STATISTICS 1000`
		)
		console.log('   ✅ Statistics configuration updated')

		// 2. Add partial index for published attributes filtered by category
		console.log('\n2. Creating partial index for published attributes...')
		await db.execute(sql`
			CREATE INDEX IF NOT EXISTS dgm_attribute_types_category_published_idx
			ON dgm_attribute_types(category_id)
			WHERE published = true
		`)
		console.log('   ✅ Partial index created')

		// 3. Force re-analyze of tables
		console.log('\n3. Analyzing tables to update statistics...')
		await db.execute(sql`ANALYZE dgm_attribute_categories`)
		await db.execute(sql`ANALYZE dgm_attribute_types`)
		await db.execute(sql`ANALYZE dgm_type_attributes`)
		console.log('   ✅ Table statistics updated')

		// 4. Get some statistics about the tables
		console.log('\n4. Table statistics:')
		const tableStats = await db.execute(sql`
			SELECT
				relname as table_name,
				n_live_tup as row_count,
				pg_size_pretty(pg_total_relation_size(relid)) as total_size
			FROM pg_stat_user_tables
			WHERE relname LIKE 'dgm_%'
			ORDER BY n_live_tup DESC
		`)

		for (const stat of tableStats.rows) {
			console.log(
				`   - ${stat.table_name}: ${stat.row_count} rows, ${stat.total_size}`
			)
		}

		// 5. Show index usage
		console.log('\n5. Index statistics:')
		const indexStats = await db.execute(sql`
			SELECT
				indexname,
				idx_scan as scans,
				pg_size_pretty(pg_relation_size(indexname::regclass)) as size
			FROM pg_stat_user_indexes
			WHERE tablename LIKE 'dgm_%'
			ORDER BY idx_scan DESC
		`)

		for (const stat of indexStats.rows) {
			console.log(`   - ${stat.indexname}: ${stat.scans} scans, ${stat.size}`)
		}

		console.log('\n✅ Optimizations completed successfully!')
		console.log('\n💡 Tips for monitoring:')
		console.log('   - Run pg_stat_user_indexes to check index usage')
		console.log('   - Use EXPLAIN ANALYZE on queries to verify index usage')
		console.log('   - Monitor pg_stat_statements for slow queries')
	} catch (error) {
		console.error('❌ Error running optimizations:', error)
		throw error
	}
}

async function main() {
	const dbUrl = process.env.DATABASE_URL_MIGRATIONS || process.env.DATABASE_URL

	if (!dbUrl) {
		throw new Error('DATABASE_URL_MIGRATIONS or DATABASE_URL environment variable is not set')
	}

	const db = createDbClient(dbUrl, schema)

	try {
		await runOptimizations(db)
	} catch (error) {
		console.error('Failed to run optimizations:', error)
		process.exit(1)
	}
}

// Run the optimizations
main().catch(console.error)