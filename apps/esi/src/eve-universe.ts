import { DurableObject } from 'cloudflare:workers'

import { logger } from '@repo/hono-helpers'

import type { Env } from './context'
import type { NameCacheEntry, UniverseName } from '@repo/eve-universe'

export class EveUniverse extends DurableObject<Env> {
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env)
	}

	private async initializeSchema() {
		// Check if names table exists, if not create it
		await this.ensureNamesTable()
	}

	private async ensureNamesTable(): Promise<void> {
		try {
			// Check if names table exists
			const result = await this.ctx.storage.sql
				.exec(`SELECT name FROM sqlite_master WHERE type='table' AND name='names'`)
				.toArray()

			if (result.length === 0) {
				logger.info('Names table not found, creating it...')

				// Names cache table
				await this.ctx.storage.sql.exec(`
					CREATE TABLE IF NOT EXISTS names (
						id INTEGER PRIMARY KEY,
						name TEXT NOT NULL,
						category TEXT NOT NULL,
						cached_at INTEGER NOT NULL
					)
				`)

				await this.ctx.storage.sql.exec(`
					CREATE INDEX IF NOT EXISTS idx_names_category ON names(category)
				`)

				await this.ctx.storage.sql.exec(`
					CREATE INDEX IF NOT EXISTS idx_names_cached_at ON names(cached_at)
				`)

				logger.info('Names table created successfully')
			}
		} catch (error) {
			logger.error('Error checking/creating names table', { error: String(error) })
		}
	}

	async getNames(ids: number[]): Promise<UniverseName[]> {
		await this.initializeSchema()

		if (ids.length === 0) {
			return []
		}

		// Deduplicate IDs
		const uniqueIds = [...new Set(ids)]

		// Check cache first
		const placeholders = uniqueIds.map(() => '?').join(',')
		const cached = await this.ctx.storage.sql
			.exec<NameCacheEntry>(
				`SELECT id, name, category FROM names WHERE id IN (${placeholders})`,
				...uniqueIds
			)
			.toArray()

		const cachedMap = new Map(cached.map(c => [c.id, c]))
		const missingIds = uniqueIds.filter(id => !cachedMap.has(id))

		// If all found in cache, return them
		if (missingIds.length === 0) {
			return cached.map(c => ({ id: c.id, name: c.name, category: c.category }))
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
			const nameMap = new Map(allNames.map(n => [n.id, n]))
			return uniqueIds.map(id => nameMap.get(id)).filter((n): n is UniverseName => n !== undefined)
		} catch (error) {
			logger.error('Error fetching names from ESI', { error: String(error), ids: missingIds })

			// Return what we have from cache
			return cached.map(c => ({ id: c.id, name: c.name, category: c.category }))
		}
	}

	async getName(id: number): Promise<UniverseName | null> {
		const names = await this.getNames([id])
		return names[0] || null
	}

	async cacheNames(names: UniverseName[]): Promise<void> {
		await this.initializeSchema()

		if (names.length === 0) {
			return
		}

		const now = Date.now()

		for (const name of names) {
			try {
				await this.ctx.storage.sql.exec(
					`INSERT OR REPLACE INTO names (id, name, category, cached_at) VALUES (?, ?, ?, ?)`,
					name.id,
					name.name,
					name.category,
					now
				)
			} catch (error) {
				logger.error('Error caching name', { error: String(error), name })
			}
		}

		logger.info('Names cached', { count: names.length })
	}

	async clearOldCache(olderThan?: number): Promise<void> {
		await this.initializeSchema()

		// Default to 30 days ago
		const cutoff = olderThan || Date.now() - 30 * 24 * 60 * 60 * 1000

		await this.ctx.storage.sql.exec(
			`DELETE FROM names WHERE cached_at < ?`,
			cutoff
		)

		logger.info('Old cache entries cleared', {
			cutoffDate: new Date(cutoff).toISOString()
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

				const data = await response.json() as Array<{
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
}