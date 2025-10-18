import 'zx/globals'

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { Command } from '@commander-js/extra-typings'
import { validateArg } from '@jahands/cli-tools/args'
import { z } from 'zod'

export const migrationCmd = new Command('migration').description('Manage Durable Object migrations')

/**
 * Create a new migration file
 */
migrationCmd
	.command('create')
	.description('Create a new migration file for a Durable Object')
	.argument('<worker>', 'Worker name (e.g., core, esi, tags, groups)')
	.argument('<do-name>', 'Durable Object class name (e.g., SessionStore, CharacterDataStore)')
	.argument('<description>', 'Description of the migration (e.g., add_oauth_fields)')
	.action(async (worker, doName, description) => {
		// Validate worker exists
		const workerDir = path.join(process.cwd(), 'apps', worker)
		try {
			await fs.access(workerDir)
		} catch {
			console.error(`Worker '${worker}' not found in apps/`)
			process.exit(1)
		}

		// Create migrations directory if it doesn't exist
		const migrationsDir = path.join(workerDir, 'migrations', doName)
		await fs.mkdir(migrationsDir, { recursive: true })

		// Find the next migration number
		const files = await fs.readdir(migrationsDir).catch(() => [])
		const migrationNumbers = files
			.map((f) => {
				const match = f.match(/^(\d{3})_/)
				return match ? parseInt(match[1], 10) : 0
			})
			.filter((n) => n > 0)

		const nextNumber = migrationNumbers.length > 0 ? Math.max(...migrationNumbers) + 1 : 1
		const paddedNumber = String(nextNumber).padStart(3, '0')

		// Create migration filename
		const filename = `${paddedNumber}_${description}.sql`
		const filepath = path.join(migrationsDir, filename)

		// Create migration file with template
		const template = `-- Migration: ${description}
-- Version: ${nextNumber}
-- Created: ${new Date().toISOString()}

-- Add your SQL migration statements here
`

		await fs.writeFile(filepath, template)
		console.log(`Created migration: ${filepath}`)
	})

/**
 * Show migration status for a Durable Object
 */
migrationCmd
	.command('status')
	.description('Show migration status for a Durable Object')
	.argument('<worker>', 'Worker name (e.g., core, esi, tags, groups)')
	.argument('<do-name>', 'Durable Object class name (e.g., SessionStore, CharacterDataStore)')
	.action(async (worker, doName) => {
		const migrationsDir = path.join(process.cwd(), 'apps', worker, 'migrations', doName)

		try {
			const files = await fs.readdir(migrationsDir)
			const migrations = files.filter((f) => f.endsWith('.sql')).sort()

			if (migrations.length === 0) {
				console.log(`No migrations found for ${doName} in ${worker}`)
				return
			}

			console.log(`\nMigrations for ${worker}/${doName}:`)
			console.log('='.repeat(50))

			for (const migration of migrations) {
				const filepath = path.join(migrationsDir, migration)
				const stats = await fs.stat(filepath)
				const size = `${stats.size} bytes`
				console.log(`  ${migration.padEnd(40)} ${size}`)
			}

			console.log(`\nTotal: ${migrations.length} migration(s)`)
			console.log('\nNote: Run the worker to apply pending migrations')
		} catch (error) {
			if ((error as any).code === 'ENOENT') {
				console.log(`No migrations directory found for ${doName} in ${worker}`)
			} else {
				throw error
			}
		}
	})

/**
 * Validate all migration files
 */
migrationCmd
	.command('validate')
	.description('Validate all migration files for syntax and sequence')
	.action(async () => {
		const appsDir = path.join(process.cwd(), 'apps')
		const workers = await fs.readdir(appsDir)

		let totalMigrations = 0
		let totalErrors = 0

		for (const worker of workers) {
			const migrationsDir = path.join(appsDir, worker, 'migrations')

			try {
				const doNames = await fs.readdir(migrationsDir)

				for (const doName of doNames) {
					const doMigrationsDir = path.join(migrationsDir, doName)
					const stats = await fs.stat(doMigrationsDir)

					if (!stats.isDirectory()) continue

					const files = await fs.readdir(doMigrationsDir)
					const migrations = files.filter((f) => f.endsWith('.sql')).sort()

					if (migrations.length === 0) continue

					console.log(`\nValidating ${worker}/${doName}:`)

					// Check for sequence gaps
					const numbers: number[] = []
					for (const migration of migrations) {
						const match = migration.match(/^(\d{3})_/)
						if (!match) {
							console.error(`  ❌ Invalid filename format: ${migration}`)
							totalErrors++
							continue
						}

						const num = parseInt(match[1], 10)
						numbers.push(num)

						// Check if file is readable and not empty
						const filepath = path.join(doMigrationsDir, migration)
						const content = await fs.readFile(filepath, 'utf-8')

						if (content.trim().length === 0) {
							console.error(`  ❌ Empty migration file: ${migration}`)
							totalErrors++
						} else {
							console.log(`  ✓ ${migration}`)
							totalMigrations++
						}
					}

					// Check sequence
					numbers.sort((a, b) => a - b)
					for (let i = 0; i < numbers.length; i++) {
						if (numbers[i] !== i + 1) {
							console.error(`  ❌ Gap in migration sequence: missing version ${i + 1}`)
							totalErrors++
						}
					}
				}
			} catch (error) {
				// No migrations directory for this worker
				continue
			}
		}

		console.log('\n' + '='.repeat(50))
		console.log(`Total migrations validated: ${totalMigrations}`)
		if (totalErrors > 0) {
			console.error(`Total errors found: ${totalErrors}`)
			process.exit(1)
		} else {
			console.log('All migrations are valid ✓')
		}
	})
