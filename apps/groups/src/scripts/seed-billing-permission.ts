import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'

import { createDb } from '../db'
import { permissionCategories, permissions } from '../db/schema'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '../../../../.env') })

async function main() {
	const databaseUrl = process.env.DATABASE_URL_MIGRATIONS
	if (!databaseUrl) throw new Error('DATABASE_URL_MIGRATIONS is required')

	const db = createDb(databaseUrl)
	const [category] = await db
		.insert(permissionCategories)
		.values({
			name: 'Billing',
			description: 'Permissions for manual bill issuance and management',
		})
		.onConflictDoUpdate({
			target: permissionCategories.name,
			set: { description: 'Permissions for manual bill issuance and management' },
		})
		.returning()

	await db
		.insert(permissions)
		.values({
			urn: 'urn:billing:issuer',
			name: 'Issue Bills',
			description: 'Create and manage manually issued bills owned by the current user',
			categoryId: category.id,
			createdBy: 'system',
		})
		.onConflictDoUpdate({
			target: permissions.urn,
			set: {
				name: 'Issue Bills',
				description: 'Create and manage manually issued bills owned by the current user',
				categoryId: category.id,
			},
		})

	console.log('Billing issuer permission seeded successfully')
	process.exit(0)
}

main().catch((error) => {
	console.error('Seed failed:', error)
	process.exit(1)
})
