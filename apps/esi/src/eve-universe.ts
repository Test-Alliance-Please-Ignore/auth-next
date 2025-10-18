import { MigratableDurableObject, loadMigrationsFromBuild } from '@repo/do-migrations'
import { logger } from '@repo/hono-helpers'

import type {
	CategoryInfo,
	GroupInfo,
	NameCacheEntry,
	TypeInfo,
	UniverseName,
} from '@repo/eve-universe'
import type { Env } from './context'
import {
	fetchCategoryInfo,
	fetchGroupInfo,
	fetchTypeInfo,
	type ESICategoryInfo,
	type ESIGroupInfo,
	type ESITypeInfo,
} from './esi-client'
import { eveUniverseMigrations } from './migrations'

export class EveUniverse extends MigratableDurableObject<Env> {
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env, {
			migrationDir: 'EveUniverse',
			autoMigrate: true,
			verbose: env.ENVIRONMENT === 'development',
		})
	}

	protected async loadMigrations() {
		return loadMigrationsFromBuild(eveUniverseMigrations)
	}


	async getNames(ids: number[]): Promise<UniverseName[]> {

		if (ids.length === 0) {
			return []
		}

		// Deduplicate IDs
		const uniqueIds = [...new Set(ids)]

		// SQLite has a limit on the number of variables in a query (usually 999)
		// But Cloudflare's SQLite might have a lower limit, so we'll be more conservative
		const BATCH_SIZE = 200 // More conservative limit for Cloudflare's SQLite
		const cached: NameCacheEntry[] = []

		// Query cache in batches
		for (let i = 0; i < uniqueIds.length; i += BATCH_SIZE) {
			const batch = uniqueIds.slice(i, i + BATCH_SIZE)

			// Skip empty batches (shouldn't happen but just in case)
			if (batch.length === 0) {
				continue
			}

			const placeholders = batch.map(() => '?').join(',')

			try {
				logger.info('Querying names batch', {
					batchSize: batch.length,
					batchIndex: Math.floor(i / BATCH_SIZE),
					totalBatches: Math.ceil(uniqueIds.length / BATCH_SIZE),
				})

				const batchResults = await this.ctx.storage.sql
					.exec<NameCacheEntry>(
						`SELECT id, name, category FROM names WHERE id IN (${placeholders})`,
						...batch
					)
					.toArray()
				cached.push(...batchResults)
			} catch (error) {
				logger.error('Error querying names batch from cache', {
					error: String(error),
					batchSize: batch.length,
					totalIds: uniqueIds.length,
					batchStart: i,
					firstIds: batch.slice(0, 5),
					queryLength: placeholders.length,
				})

				// If this is a "too many variables" error, try with smaller batch
				if (String(error).includes('too many SQL variables')) {
					const FALLBACK_BATCH_SIZE = 100
					for (let j = 0; j < batch.length; j += FALLBACK_BATCH_SIZE) {
						const smallBatch = batch.slice(j, j + FALLBACK_BATCH_SIZE)
						const smallPlaceholders = smallBatch.map(() => '?').join(',')
						try {
							const smallResults = await this.ctx.storage.sql
								.exec<NameCacheEntry>(
									`SELECT id, name, category FROM names WHERE id IN (${smallPlaceholders})`,
									...smallBatch
								)
								.toArray()
							cached.push(...smallResults)
						} catch (innerError) {
							logger.error('Error with smaller batch', {
								error: String(innerError),
								batchSize: smallBatch.length,
							})
						}
					}
				} else {
					throw error
				}
			}
		}

		const cachedMap = new Map(cached.map((c) => [c.id, c]))
		const missingIds = uniqueIds.filter((id) => !cachedMap.has(id))

		// If all found in cache, return them
		if (missingIds.length === 0) {
			return cached.map((c) => ({ id: c.id, name: c.name, category: c.category }))
		}

		// Fetch missing from ESI
		try {
			const fetchedNames = await this.fetchNamesFromESI(missingIds)

			// Cache the fetched names
			if (fetchedNames.length > 0) {
				await this.cacheNames(fetchedNames)
			}

			// Combine cached and fetched
			const allNames = [...cached, ...fetchedNames]

			// Return in the same order as requested
			const nameMap = new Map(allNames.map((n) => [n.id, n]))
			return uniqueIds
				.map((id) => nameMap.get(id))
				.filter((n): n is UniverseName => n !== undefined)
		} catch (error) {
			logger.error('Error fetching names from ESI', { error: String(error), ids: missingIds })

			// Return what we have from cache
			return cached.map((c) => ({ id: c.id, name: c.name, category: c.category }))
		}
	}

	async getName(id: number): Promise<UniverseName | null> {
		const names = await this.getNames([id])
		return names[0] || null
	}

	async cacheNames(names: UniverseName[]): Promise<void> {

		if (names.length === 0) {
			return
		}

		const now = Date.now()
		const BATCH_SIZE = 50 // Even smaller batch size for inserts (4 values per row = 200 variables)

		// Process in batches to avoid too many SQL variables
		for (let i = 0; i < names.length; i += BATCH_SIZE) {
			const batch = names.slice(i, i + BATCH_SIZE)

			// Build multi-row insert statement
			const placeholders = batch.map(() => '(?, ?, ?, ?)').join(',')
			const values: any[] = []

			for (const name of batch) {
				values.push(name.id, name.name, name.category, now)
			}

			try {
				await this.ctx.storage.sql.exec(
					`INSERT OR REPLACE INTO names (id, name, category, cached_at) VALUES ${placeholders}`,
					...values
				)
			} catch (error) {
				logger.error('Error caching batch of names', {
					error: String(error),
					batchSize: batch.length,
					firstId: batch[0]?.id,
				})

				// Fall back to individual inserts for this batch
				for (const name of batch) {
					try {
						await this.ctx.storage.sql.exec(
							`INSERT OR REPLACE INTO names (id, name, category, cached_at) VALUES (?, ?, ?, ?)`,
							name.id,
							name.name,
							name.category,
							now
						)
					} catch (innerError) {
						logger.error('Error caching individual name', { error: String(innerError), name })
					}
				}
			}
		}

		logger.info('Names cached', { count: names.length })
	}

	async clearOldCache(olderThan?: number): Promise<void> {

		// Default to 30 days ago
		const cutoff = olderThan || Date.now() - 30 * 24 * 60 * 60 * 1000

		await this.ctx.storage.sql.exec(`DELETE FROM names WHERE cached_at < ?`, cutoff)

		logger.info('Old cache entries cleared', {
			cutoffDate: new Date(cutoff).toISOString(),
		})
	}

	private async fetchNamesFromESI(ids: number[]): Promise<UniverseName[]> {
		if (ids.length === 0) {
			return []
		}

		// ESI has a limit of 1000 IDs per request
		const chunks: number[][] = []
		for (let i = 0; i < ids.length; i += 1000) {
			chunks.push(ids.slice(i, i + 1000))
		}

		const allResults: UniverseName[] = []

		for (const chunk of chunks) {
			try {
				const response = await fetch('https://esi.evetech.net/latest/universe/names/', {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'X-Compatibility-Date': '2025-09-30',
					},
					body: JSON.stringify(chunk),
				})

				if (!response.ok) {
					logger.error('ESI universe/names request failed', {
						status: response.status,
						statusText: response.statusText,
						ids: chunk.slice(0, 10), // Log first 10 IDs for debugging
					})
					continue
				}

				const data = (await response.json()) as Array<{
					id: number
					name: string
					category: string
				}>

				allResults.push(...data)

				logger.info('Fetched names from ESI', {
					requested: chunk.length,
					received: data.length,
				})
			} catch (error) {
				logger.error('Error fetching names from ESI', {
					error: String(error),
					chunkSize: chunk.length,
				})
			}
		}

		return allResults
	}

	async getTypes(typeIds: number[]): Promise<TypeInfo[]> {
		if (typeIds.length === 0) {
			return []
		}

		// Deduplicate IDs
		const uniqueIds = [...new Set(typeIds)]
		const BATCH_SIZE = 200
		const cached: TypeInfo[] = []

		// Query cache in batches
		for (let i = 0; i < uniqueIds.length; i += BATCH_SIZE) {
			const batch = uniqueIds.slice(i, i + BATCH_SIZE)
			if (batch.length === 0) continue

			const placeholders = batch.map(() => '?').join(',')

			try {
				const batchResults = await this.ctx.storage.sql
					.exec<TypeInfo>(
						`SELECT type_id, name, group_id, description, published, cached_at
						 FROM types WHERE type_id IN (${placeholders})`,
						...batch
					)
					.toArray()
				cached.push(...batchResults)
			} catch (error) {
				logger.error('Error querying types batch from cache', {
					error: String(error),
					batchSize: batch.length,
				})
			}
		}

		// Find missing type IDs
		const cachedIds = new Set(cached.map((t) => t.type_id))
		const missingIds = uniqueIds.filter((id) => !cachedIds.has(id))

		if (missingIds.length > 0) {
			// Fetch missing types from ESI
			const fetched = await this.fetchTypesFromESI(missingIds)

			// Cache the fetched types
			if (fetched.length > 0) {
				await this.cacheTypes(fetched)
				cached.push(...fetched)
			}
		}

		// Return in the original order
		const typeMap = new Map(cached.map((t) => [t.type_id, t]))
		return typeIds.map((id) => typeMap.get(id)).filter((t): t is TypeInfo => t !== undefined)
	}

	async getGroups(groupIds: number[]): Promise<GroupInfo[]> {
		if (groupIds.length === 0) {
			return []
		}

		// Deduplicate IDs
		const uniqueIds = [...new Set(groupIds)]
		const BATCH_SIZE = 200
		const cached: GroupInfo[] = []

		// Query cache in batches
		for (let i = 0; i < uniqueIds.length; i += BATCH_SIZE) {
			const batch = uniqueIds.slice(i, i + BATCH_SIZE)
			if (batch.length === 0) continue

			const placeholders = batch.map(() => '?').join(',')

			try {
				const batchResults = await this.ctx.storage.sql
					.exec<GroupInfo>(
						`SELECT group_id, name, category_id, published, cached_at
						 FROM groups WHERE group_id IN (${placeholders})`,
						...batch
					)
					.toArray()
				cached.push(...batchResults)
			} catch (error) {
				logger.error('Error querying groups batch from cache', {
					error: String(error),
					batchSize: batch.length,
				})
			}
		}

		// Find missing group IDs
		const cachedIds = new Set(cached.map((g) => g.group_id))
		const missingIds = uniqueIds.filter((id) => !cachedIds.has(id))

		if (missingIds.length > 0) {
			// Fetch missing groups from ESI
			const fetched = await this.fetchGroupsFromESI(missingIds)

			// Cache the fetched groups
			if (fetched.length > 0) {
				await this.cacheGroups(fetched)
				cached.push(...fetched)
			}
		}

		// Return in the original order
		const groupMap = new Map(cached.map((g) => [g.group_id, g]))
		return groupIds.map((id) => groupMap.get(id)).filter((g): g is GroupInfo => g !== undefined)
	}

	async getCategories(categoryIds: number[]): Promise<CategoryInfo[]> {
		if (categoryIds.length === 0) {
			return []
		}

		// Deduplicate IDs
		const uniqueIds = [...new Set(categoryIds)]
		const BATCH_SIZE = 200
		const cached: CategoryInfo[] = []

		// Query cache in batches
		for (let i = 0; i < uniqueIds.length; i += BATCH_SIZE) {
			const batch = uniqueIds.slice(i, i + BATCH_SIZE)
			if (batch.length === 0) continue

			const placeholders = batch.map(() => '?').join(',')

			try {
				const batchResults = await this.ctx.storage.sql
					.exec<CategoryInfo>(
						`SELECT category_id, name, published, cached_at
						 FROM categories WHERE category_id IN (${placeholders})`,
						...batch
					)
					.toArray()
				cached.push(...batchResults)
			} catch (error) {
				logger.error('Error querying categories batch from cache', {
					error: String(error),
					batchSize: batch.length,
				})
			}
		}

		// Find missing category IDs
		const cachedIds = new Set(cached.map((c) => c.category_id))
		const missingIds = uniqueIds.filter((id) => !cachedIds.has(id))

		if (missingIds.length > 0) {
			// Fetch missing categories from ESI
			const fetched = await this.fetchCategoriesFromESI(missingIds)

			// Cache the fetched categories
			if (fetched.length > 0) {
				await this.cacheCategories(fetched)
				cached.push(...fetched)
			}
		}

		// Return in the original order
		const categoryMap = new Map(cached.map((c) => [c.category_id, c]))
		return categoryIds.map((id) => categoryMap.get(id)).filter((c): c is CategoryInfo => c !== undefined)
	}

	async getSkillHierarchy(skillIds: number[]): Promise<Array<{
		skill_id: number
		skill_name: string
		group_id: number
		group_name: string
		category_id: number
		category_name: string
	}>> {
		if (skillIds.length === 0) {
			return []
		}

		// Get type information for all skills
		const types = await this.getTypes(skillIds)

		// Extract unique group IDs
		const groupIds = [...new Set(types.map((t) => t.group_id))]

		// Get group information
		const groups = await this.getGroups(groupIds)

		// Extract unique category IDs
		const categoryIds = [...new Set(groups.map((g) => g.category_id))]

		// Get category information
		const categories = await this.getCategories(categoryIds)

		// Create maps for quick lookup
		const typeMap = new Map(types.map((t) => [t.type_id, t]))
		const groupMap = new Map(groups.map((g) => [g.group_id, g]))
		const categoryMap = new Map(categories.map((c) => [c.category_id, c]))

		// Build the hierarchy
		return skillIds
			.map((skillId) => {
				const type = typeMap.get(skillId)
				if (!type) return null

				const group = groupMap.get(type.group_id)
				if (!group) return null

				const category = categoryMap.get(group.category_id)
				if (!category) return null

				return {
					skill_id: skillId,
					skill_name: type.name,
					group_id: type.group_id,
					group_name: group.name,
					category_id: group.category_id,
					category_name: category.name,
				}
			})
			.filter((h): h is NonNullable<typeof h> => h !== null)
	}

	private async cacheTypes(types: TypeInfo[]): Promise<void> {
		if (types.length === 0) {
			return
		}

		const now = Date.now()
		const BATCH_SIZE = 50

		for (let i = 0; i < types.length; i += BATCH_SIZE) {
			const batch = types.slice(i, i + BATCH_SIZE)

			try {
				const placeholders = batch.map(() => '(?, ?, ?, ?, ?, ?)').join(',')
				const values = batch.flatMap((t) => [
					t.type_id,
					t.name,
					t.group_id,
					t.description || '',
					t.published ? 1 : 0,
					now,
				])

				await this.ctx.storage.sql.exec(
					`INSERT OR REPLACE INTO types (type_id, name, group_id, description, published, cached_at)
					 VALUES ${placeholders}`,
					...values
				)
			} catch (error) {
				logger.error('Error caching types batch', {
					error: String(error),
					batchSize: batch.length,
				})
			}
		}

		logger.info('Types cached', { count: types.length })
	}

	private async cacheGroups(groups: GroupInfo[]): Promise<void> {
		if (groups.length === 0) {
			return
		}

		const now = Date.now()
		const BATCH_SIZE = 50

		for (let i = 0; i < groups.length; i += BATCH_SIZE) {
			const batch = groups.slice(i, i + BATCH_SIZE)

			try {
				const placeholders = batch.map(() => '(?, ?, ?, ?, ?)').join(',')
				const values = batch.flatMap((g) => [
					g.group_id,
					g.name,
					g.category_id,
					g.published ? 1 : 0,
					now,
				])

				await this.ctx.storage.sql.exec(
					`INSERT OR REPLACE INTO groups (group_id, name, category_id, published, cached_at)
					 VALUES ${placeholders}`,
					...values
				)
			} catch (error) {
				logger.error('Error caching groups batch', {
					error: String(error),
					batchSize: batch.length,
				})
			}
		}

		logger.info('Groups cached', { count: groups.length })
	}

	private async cacheCategories(categories: CategoryInfo[]): Promise<void> {
		if (categories.length === 0) {
			return
		}

		const now = Date.now()
		const BATCH_SIZE = 50

		for (let i = 0; i < categories.length; i += BATCH_SIZE) {
			const batch = categories.slice(i, i + BATCH_SIZE)

			try {
				const placeholders = batch.map(() => '(?, ?, ?, ?)').join(',')
				const values = batch.flatMap((c) => [
					c.category_id,
					c.name,
					c.published ? 1 : 0,
					now,
				])

				await this.ctx.storage.sql.exec(
					`INSERT OR REPLACE INTO categories (category_id, name, published, cached_at)
					 VALUES ${placeholders}`,
					...values
				)
			} catch (error) {
				logger.error('Error caching categories batch', {
					error: String(error),
					batchSize: batch.length,
				})
			}
		}

		logger.info('Categories cached', { count: categories.length })
	}

	private async fetchTypesFromESI(typeIds: number[]): Promise<TypeInfo[]> {
		const results: TypeInfo[] = []

		for (const typeId of typeIds) {
			try {
				const { data } = await fetchTypeInfo(typeId)
				results.push({
					type_id: data.type_id,
					name: data.name,
					group_id: data.group_id,
					description: data.description,
					published: data.published,
					cached_at: Date.now(),
				})
			} catch (error) {
				logger.error('Error fetching type info from ESI', {
					error: String(error),
					typeId,
				})
			}
		}

		return results
	}

	private async fetchGroupsFromESI(groupIds: number[]): Promise<GroupInfo[]> {
		const results: GroupInfo[] = []

		for (const groupId of groupIds) {
			try {
				const { data } = await fetchGroupInfo(groupId)
				results.push({
					group_id: data.group_id,
					name: data.name,
					category_id: data.category_id,
					published: data.published,
					cached_at: Date.now(),
				})
			} catch (error) {
				logger.error('Error fetching group info from ESI', {
					error: String(error),
					groupId,
				})
			}
		}

		return results
	}

	private async fetchCategoriesFromESI(categoryIds: number[]): Promise<CategoryInfo[]> {
		const results: CategoryInfo[] = []

		for (const categoryId of categoryIds) {
			try {
				const { data } = await fetchCategoryInfo(categoryId)
				results.push({
					category_id: data.category_id,
					name: data.name,
					published: data.published,
					cached_at: Date.now(),
				})
			} catch (error) {
				logger.error('Error fetching category info from ESI', {
					error: String(error),
					categoryId,
				})
			}
		}

		return results
	}
}
