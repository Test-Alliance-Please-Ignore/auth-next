import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'
import { eq } from 'drizzle-orm'

import { createDb } from '../../src/common/db'
import { corporations, structures } from '../../src/common/db/schema'

import type { BeancounterDb } from '../../src/common/db'
import type { CorporationRow, NewCorporationRow, StructureRow, NewStructureRow } from '../../src/common/db/schema'

// Load .env from beancounter directory
const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '../../.dev.vars') })
config({ path: resolve(__dirname, '../../../../.env') })

let dbInstance: BeancounterDb | null = null

/**
 * Get or create database client instance
 */
export function getDb(): BeancounterDb {
	if (dbInstance) {
		return dbInstance
	}

	const databaseUrl = process.env.DATABASE_URL

	if (!databaseUrl) {
		throw new Error('DATABASE_URL environment variable is required')
	}

	dbInstance = createDb(databaseUrl)
	return dbInstance
}

/**
 * Corporation CRUD operations
 */
export const corpDb = {
	async list(): Promise<CorporationRow[]> {
		const db = getDb()
		return await db.query.corporations.findMany({
			orderBy: (corps, { asc }) => [asc(corps.corporationId)],
		})
	},

	async getById(id: string): Promise<CorporationRow | null> {
		const db = getDb()
		return await db.query.corporations.findFirst({
			where: eq(corporations.id, id),
		})
	},

	async getByCorporationId(corporationId: string): Promise<CorporationRow | null> {
		const db = getDb()
		return await db.query.corporations.findFirst({
			where: eq(corporations.corporationId, corporationId),
		})
	},

	async create(data: NewCorporationRow): Promise<CorporationRow> {
		const db = getDb()
		const [corp] = await db.insert(corporations).values(data).returning()
		return corp
	},

	async update(id: string, data: Partial<NewCorporationRow>): Promise<CorporationRow> {
		const db = getDb()
		const [corp] = await db
			.update(corporations)
			.set({ ...data, updatedAt: new Date() })
			.where(eq(corporations.id, id))
			.returning()
		if (!corp) {
			throw new Error(`Corporation with id ${id} not found`)
		}
		return corp
	},

	async delete(id: string): Promise<void> {
		const db = getDb()
		await db.delete(corporations).where(eq(corporations.id, id))
	},

	async toggleTracking(id: string): Promise<CorporationRow> {
		const corp = await this.getById(id)
		if (!corp) {
			throw new Error(`Corporation with id ${id} not found`)
		}
		return await this.update(id, { trackingEnabled: !corp.trackingEnabled })
	},
}

/**
 * Structure CRUD operations
 */
export const structDb = {
	async list(corporationId?: string): Promise<StructureRow[]> {
		const db = getDb()
		if (corporationId) {
			const corp = await corpDb.getByCorporationId(corporationId)
			if (!corp) {
				throw new Error(`Corporation with id ${corporationId} not found`)
			}
			return await db.query.structures.findMany({
				where: eq(structures.corporationId, corp.id),
				orderBy: (structs, { asc }) => [asc(structs.structureId)],
			})
		}
		return await db.query.structures.findMany({
			orderBy: (structs, { asc }) => [asc(structs.structureId)],
		})
	},

	async getById(id: string): Promise<StructureRow | null> {
		const db = getDb()
		return await db.query.structures.findFirst({
			where: eq(structures.id, id),
		})
	},

	async getByStructureId(structureId: string): Promise<StructureRow | null> {
		const db = getDb()
		return await db.query.structures.findFirst({
			where: eq(structures.structureId, structureId),
		})
	},

	async create(data: NewStructureRow): Promise<StructureRow> {
		const db = getDb()
		const [struct] = await db.insert(structures).values(data).returning()
		return struct
	},

	async update(id: string, data: Partial<NewStructureRow>): Promise<StructureRow> {
		const db = getDb()
		const [struct] = await db
			.update(structures)
			.set({ ...data, updatedAt: new Date() })
			.where(eq(structures.id, id))
			.returning()
		if (!struct) {
			throw new Error(`Structure with id ${id} not found`)
		}
		return struct
	},

	async delete(id: string): Promise<void> {
		const db = getDb()
		await db.delete(structures).where(eq(structures.id, id))
	},

	async toggleMonitoring(id: string): Promise<StructureRow> {
		const struct = await this.getById(id)
		if (!struct) {
			throw new Error(`Structure with id ${id} not found`)
		}
		return await this.update(id, { monitoringEnabled: !struct.monitoringEnabled })
	},
}

