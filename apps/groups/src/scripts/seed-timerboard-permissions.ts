import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'

import { TIMERBOARD_PERMISSION_DEFINITIONS } from '@repo/core'

import { createDb } from '../db'
import { permissionCategories, permissions } from '../db/schema'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(scriptDirectory, '../../../../.env') })

async function main() {
	const databaseUrl = process.env.DATABASE_URL_MIGRATIONS
	if (!databaseUrl) throw new Error('DATABASE_URL_MIGRATIONS is required')

	const db = createDb(databaseUrl)
	const [category] = await db
		.insert(permissionCategories)
		.values({
			name: 'Timerboard',
			description: 'Permissions for the shared operational timerboard',
		})
		.onConflictDoUpdate({
			target: permissionCategories.name,
			set: { description: 'Permissions for the shared operational timerboard' },
		})
		.returning()

	if (!category) throw new Error('Timerboard permission category upsert returned no row')

	for (const permission of TIMERBOARD_PERMISSION_DEFINITIONS) {
		await db
			.insert(permissions)
			.values({
				...permission,
				categoryId: category.id,
				createdBy: 'system',
			})
			.onConflictDoUpdate({
				target: permissions.urn,
				set: {
					name: permission.name,
					description: permission.description,
					categoryId: category.id,
				},
			})
	}

	console.log('Timerboard permissions seeded successfully')
	process.exit(0)
}

main().catch((error) => {
	console.error('Timerboard permission seed failed:', error)
	process.exit(1)
})
