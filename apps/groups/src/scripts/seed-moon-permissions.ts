import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'

import { createDb } from '../db'
import { permissionCategories, permissions } from '../db/schema'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '../../../../.env') })

const MOON_PERMISSIONS = [
	{
		urn: 'urn:moons:view',
		name: 'View Moons',
		description: 'Browse moon list, region map, and system detail pages',
	},
	{
		urn: 'urn:moons:submit',
		name: 'Submit Scans',
		description: 'Paste and submit moon scan data (TSV from EVE client)',
	},
	{
		urn: 'urn:moons:validate',
		name: 'Validate Scans',
		description: 'Approve or reject scans in the validation queue; own submissions auto-verify',
	},
	{
		urn: 'urn:moons:admin',
		name: 'Moon Admin',
		description: 'Manage extraction settings and structure profiles',
	},
]

async function main() {
	const databaseUrl = process.env.DATABASE_URL_MIGRATIONS
	if (!databaseUrl) throw new Error('DATABASE_URL_MIGRATIONS is required')

	const db = createDb(databaseUrl)

	// Create the "Moon Scanning" category if it doesn't exist
	const [category] = await db
		.insert(permissionCategories)
		.values({
			name: 'Moon Scanning',
			description: 'Permissions for moon scan submission and management',
		})
		.onConflictDoUpdate({
			target: permissionCategories.name,
			set: { description: 'Permissions for moon scan submission and management' },
		})
		.returning()

	console.log('Permission category:', category.name, '(id:', category.id + ')')

	// Insert permissions
	for (const perm of MOON_PERMISSIONS) {
		const [row] = await db
			.insert(permissions)
			.values({
				urn: perm.urn,
				name: perm.name,
				description: perm.description,
				categoryId: category.id,
				createdBy: 'system',
			})
			.onConflictDoUpdate({
				target: permissions.urn,
				set: {
					name: perm.name,
					description: perm.description,
					categoryId: category.id,
				},
			})
			.returning()

		console.log('  ✓', row.urn)
	}

	console.log('\nMoon permissions seeded successfully!')
	process.exit(0)
}

main().catch((err) => {
	console.error('Seed failed:', err)
	process.exit(1)
})
