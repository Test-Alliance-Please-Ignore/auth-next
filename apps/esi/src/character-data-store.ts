import { DurableObject } from 'cloudflare:workers'

import { logger } from '@repo/hono-helpers'
import { getStub } from '@repo/do-utils'
import type { UserTokenStore } from '@repo/user-token-store'

import type { ESICharacterInfo, ESICorporationInfo } from './esi-client'
import { fetchCharacterInfo, fetchCorporationInfo } from './esi-client'
import type { Env } from './context'

export interface CharacterData extends Record<string, number | string | null> {
	character_id: number
	name: string
	corporation_id: number
	alliance_id: number | null
	security_status: number | null
	birthday: string
	gender: string
	race_id: number
	bloodline_id: number
	ancestry_id: number | null
	description: string | null
	last_updated: number
	next_update_at: number
	update_count: number
}

export interface CorporationData extends Record<string, number | string | null> {
	corporation_id: number
	name: string
	ticker: string
	member_count: number
	ceo_id: number
	creator_id: number
	date_founded: string | null
	tax_rate: number
	url: string | null
	description: string | null
	alliance_id: number | null
	last_updated: number
	next_update_at: number
	update_count: number
}

export interface ChangeHistoryEntry extends Record<string, number | string | null> {
	id: number
	character_id: number
	changed_at: number
	field_name: string
	old_value: string | null
	new_value: string | null
}

export class CharacterDataStore extends DurableObject<Env> {
	private schemaInitialized = false
	private readonly CURRENT_SCHEMA_VERSION = 1
	private alarmScheduled = false

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env)
	}

	private async getSchemaVersion(): Promise<number> {
		// Create schema_version table if it doesn't exist
		await this.ctx.storage.sql.exec(`
			CREATE TABLE IF NOT EXISTS schema_version (
				version INTEGER PRIMARY KEY,
				applied_at INTEGER NOT NULL
			)
		`)

		const rows = await this.ctx.storage.sql
			.exec<{ version: number }>('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
			.toArray()

		return rows.length > 0 ? rows[0].version : 0
	}

	private async setSchemaVersion(version: number): Promise<void> {
		const now = Date.now()
		await this.ctx.storage.sql.exec(
			'INSERT OR REPLACE INTO schema_version (version, applied_at) VALUES (?, ?)',
			version,
			now
		)
	}

	private async ensureSchema() {
		// Only run migrations once per DO instance
		if (this.schemaInitialized) {
			return
		}

		try {
			const currentVersion = await this.getSchemaVersion()

			logger.info('Running character data schema migrations', {
				currentVersion,
				targetVersion: this.CURRENT_SCHEMA_VERSION,
			})

			// Migration 1: Initial schema with characters, corporations, and history tables
			if (currentVersion < 1) {
				await this.runMigration1()
				await this.setSchemaVersion(1)
				logger.info('Applied migration 1: Initial character data schema')
			}

			this.schemaInitialized = true
		} catch (error) {
			// If migration fails, don't mark as initialized so it retries
			logger.error('Character data schema migration failed', {
				error: error instanceof Error ? error.message : String(error),
			})
			throw error
		}
	}

	private async runMigration1(): Promise<void> {
		// Characters table
		await this.ctx.storage.sql.exec(`
			CREATE TABLE IF NOT EXISTS characters (
				character_id INTEGER PRIMARY KEY,
				name TEXT NOT NULL,
				corporation_id INTEGER NOT NULL,
				alliance_id INTEGER,
				security_status REAL,
				birthday TEXT NOT NULL,
				gender TEXT NOT NULL,
				race_id INTEGER NOT NULL,
				bloodline_id INTEGER NOT NULL,
				ancestry_id INTEGER,
				description TEXT,
				last_updated INTEGER NOT NULL,
				next_update_at INTEGER NOT NULL,
				update_count INTEGER NOT NULL DEFAULT 0
			)
		`)

		await this.ctx.storage.sql.exec(`
			CREATE INDEX IF NOT EXISTS idx_characters_next_update ON characters(next_update_at)
		`)

		await this.ctx.storage.sql.exec(`
			CREATE INDEX IF NOT EXISTS idx_characters_corporation ON characters(corporation_id)
		`)

		// Corporations table
		await this.ctx.storage.sql.exec(`
			CREATE TABLE IF NOT EXISTS corporations (
				corporation_id INTEGER PRIMARY KEY,
				name TEXT NOT NULL,
				ticker TEXT NOT NULL,
				member_count INTEGER NOT NULL,
				ceo_id INTEGER NOT NULL,
				creator_id INTEGER NOT NULL,
				date_founded TEXT,
				tax_rate REAL NOT NULL,
				url TEXT,
				description TEXT,
				alliance_id INTEGER,
				last_updated INTEGER NOT NULL,
				next_update_at INTEGER NOT NULL,
				update_count INTEGER NOT NULL DEFAULT 0
			)
		`)

		await this.ctx.storage.sql.exec(`
			CREATE INDEX IF NOT EXISTS idx_corporations_next_update ON corporations(next_update_at)
		`)

		// Character history table for tracking changes
		await this.ctx.storage.sql.exec(`
			CREATE TABLE IF NOT EXISTS character_history (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				character_id INTEGER NOT NULL,
				changed_at INTEGER NOT NULL,
				field_name TEXT NOT NULL,
				old_value TEXT,
				new_value TEXT,
				FOREIGN KEY (character_id) REFERENCES characters(character_id) ON DELETE CASCADE
			)
		`)

		await this.ctx.storage.sql.exec(`
			CREATE INDEX IF NOT EXISTS idx_history_character ON character_history(character_id, changed_at)
		`)
	}

	async upsertCharacter(
		characterId: number,
		data: ESICharacterInfo,
		expiresAt: number | null
	): Promise<CharacterData> {
		await this.ensureSchema()

		const now = Date.now()
		const nextUpdateAt = expiresAt || now + 3600 * 1000 // Default 1 hour if no cache header

		// Check for existing character to detect changes
		const existing = await this.ctx.storage.sql
			.exec<CharacterData>('SELECT * FROM characters WHERE character_id = ?', characterId)
			.toArray()

		const isUpdate = existing.length > 0
		const oldData = existing[0]

		if (isUpdate) {
			// Detect changes and log to history
			const changes: Array<{ field: string; oldValue: string | null; newValue: string | null }> = []

			if (oldData.corporation_id !== data.corporation_id) {
				changes.push({
					field: 'corporation_id',
					oldValue: String(oldData.corporation_id),
					newValue: String(data.corporation_id),
				})
			}

			const newAllianceId = data.alliance_id || null
			if (oldData.alliance_id !== newAllianceId) {
				changes.push({
					field: 'alliance_id',
					oldValue: oldData.alliance_id ? String(oldData.alliance_id) : null,
					newValue: newAllianceId ? String(newAllianceId) : null,
				})
			}

			// Log significant changes
			if (changes.length > 0) {
				logger
					.withTags({
						type: 'character_changes_detected',
						character_id: characterId,
					})
					.info('Character changes detected', {
						characterId,
						characterName: data.name,
						changes,
					})

				// Store changes in history
				for (const change of changes) {
					await this.ctx.storage.sql.exec(
						`INSERT INTO character_history (character_id, changed_at, field_name, old_value, new_value)
						VALUES (?, ?, ?, ?, ?)`,
						characterId,
						now,
						change.field,
						change.oldValue,
						change.newValue
					)
				}
			}

			// Update existing character
			await this.ctx.storage.sql.exec(
				`UPDATE characters
				SET name = ?, corporation_id = ?, alliance_id = ?, security_status = ?,
					birthday = ?, gender = ?, race_id = ?, bloodline_id = ?,
					ancestry_id = ?, description = ?, last_updated = ?,
					next_update_at = ?, update_count = update_count + 1
				WHERE character_id = ?`,
				data.name,
				data.corporation_id,
				data.alliance_id || null,
				data.security_status || null,
				data.birthday,
				data.gender,
				data.race_id,
				data.bloodline_id,
				data.ancestry_id || null,
				data.description || null,
				now,
				nextUpdateAt,
				characterId
			)

			logger
				.withTags({
					type: 'character_updated',
					character_id: characterId,
				})
				.info('Character data updated', {
					characterId,
					characterName: data.name,
					updateCount: oldData.update_count + 1,
					nextUpdateAt: new Date(nextUpdateAt).toISOString(),
				})
		} else {
			// Insert new character
			await this.ctx.storage.sql.exec(
				`INSERT INTO characters (
					character_id, name, corporation_id, alliance_id, security_status,
					birthday, gender, race_id, bloodline_id, ancestry_id, description,
					last_updated, next_update_at, update_count
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
				characterId,
				data.name,
				data.corporation_id,
				data.alliance_id || null,
				data.security_status || null,
				data.birthday,
				data.gender,
				data.race_id,
				data.bloodline_id,
				data.ancestry_id || null,
				data.description || null,
				now,
				nextUpdateAt
			)

			logger
				.withTags({
					type: 'character_created',
					character_id: characterId,
				})
				.info('Character data created', {
					characterId,
					characterName: data.name,
					corporationId: data.corporation_id,
					nextUpdateAt: new Date(nextUpdateAt).toISOString(),
				})
		}

		// Schedule alarm for updates
		await this.scheduleNextAlarm()

		// Return the stored character data
		const stored = await this.ctx.storage.sql
			.exec<CharacterData>('SELECT * FROM characters WHERE character_id = ?', characterId)
			.toArray()

		return stored[0]
	}

	async upsertCorporation(
		corporationId: number,
		data: ESICorporationInfo,
		expiresAt: number | null
	): Promise<CorporationData> {
		await this.ensureSchema()

		const now = Date.now()
		const nextUpdateAt = expiresAt || now + 3600 * 1000 // Default 1 hour if no cache header

		// Check for existing corporation
		const existing = await this.ctx.storage.sql
			.exec<CorporationData>('SELECT * FROM corporations WHERE corporation_id = ?', corporationId)
			.toArray()

		const isUpdate = existing.length > 0

		if (isUpdate) {
			// Update existing corporation
			await this.ctx.storage.sql.exec(
				`UPDATE corporations
				SET name = ?, ticker = ?, member_count = ?, ceo_id = ?, creator_id = ?,
					date_founded = ?, tax_rate = ?, url = ?, description = ?,
					alliance_id = ?, last_updated = ?, next_update_at = ?,
					update_count = update_count + 1
				WHERE corporation_id = ?`,
				data.name,
				data.ticker,
				data.member_count,
				data.ceo_id,
				data.creator_id,
				data.date_founded || null,
				data.tax_rate,
				data.url || null,
				data.description || null,
				data.alliance_id || null,
				now,
				nextUpdateAt,
				corporationId
			)

			logger
				.withTags({
					type: 'corporation_updated',
					corporation_id: corporationId,
				})
				.info('Corporation data updated', {
					corporationId,
					corporationName: data.name,
					updateCount: existing[0].update_count + 1,
					nextUpdateAt: new Date(nextUpdateAt).toISOString(),
				})
		} else {
			// Insert new corporation
			await this.ctx.storage.sql.exec(
				`INSERT INTO corporations (
					corporation_id, name, ticker, member_count, ceo_id, creator_id,
					date_founded, tax_rate, url, description, alliance_id,
					last_updated, next_update_at, update_count
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
				corporationId,
				data.name,
				data.ticker,
				data.member_count,
				data.ceo_id,
				data.creator_id,
				data.date_founded || null,
				data.tax_rate,
				data.url || null,
				data.description || null,
				data.alliance_id || null,
				now,
				nextUpdateAt
			)

			logger
				.withTags({
					type: 'corporation_created',
					corporation_id: corporationId,
				})
				.info('Corporation data created', {
					corporationId,
					corporationName: data.name,
					ticker: data.ticker,
					nextUpdateAt: new Date(nextUpdateAt).toISOString(),
				})
		}

		// Schedule alarm for updates
		await this.scheduleNextAlarm()

		// Return the stored corporation data
		const stored = await this.ctx.storage.sql
			.exec<CorporationData>('SELECT * FROM corporations WHERE corporation_id = ?', corporationId)
			.toArray()

		return stored[0]
	}

	async getCharacter(characterId: number): Promise<CharacterData | null> {
		await this.ensureSchema()

		const rows = await this.ctx.storage.sql
			.exec<CharacterData>('SELECT * FROM characters WHERE character_id = ?', characterId)
			.toArray()

		return rows.length > 0 ? rows[0] : null
	}

	async getCorporation(corporationId: number): Promise<CorporationData | null> {
		await this.ensureSchema()

		const rows = await this.ctx.storage.sql
			.exec<CorporationData>('SELECT * FROM corporations WHERE corporation_id = ?', corporationId)
			.toArray()

		return rows.length > 0 ? rows[0] : null
	}

	async getCharacterHistory(characterId: number): Promise<ChangeHistoryEntry[]> {
		await this.ensureSchema()

		const rows = await this.ctx.storage.sql
			.exec<ChangeHistoryEntry>(
				'SELECT * FROM character_history WHERE character_id = ? ORDER BY changed_at DESC LIMIT 100',
				characterId
			)
			.toArray()

		return rows
	}

	private async getEntitiesNeedingUpdate(): Promise<{
		characters: Array<{ character_id: number }>
		corporations: Array<{ corporation_id: number }>
	}> {
		await this.ensureSchema()

		const now = Date.now()

		const characters = await this.ctx.storage.sql
			.exec<{ character_id: number }>(
				'SELECT character_id FROM characters WHERE next_update_at <= ? LIMIT 50',
				now
			)
			.toArray()

		const corporations = await this.ctx.storage.sql
			.exec<{ corporation_id: number }>(
				'SELECT corporation_id FROM corporations WHERE next_update_at <= ? LIMIT 50',
				now
			)
			.toArray()

		return { characters, corporations }
	}

	private async scheduleNextAlarm(): Promise<void> {
		// Only schedule one alarm at a time
		if (this.alarmScheduled) {
			return
		}

		await this.ensureSchema()

		const now = Date.now()

		// Find the earliest next_update_at from both characters and corporations
		const characterRows = await this.ctx.storage.sql
			.exec<{ next_update_at: number }>(
				'SELECT next_update_at FROM characters ORDER BY next_update_at ASC LIMIT 1'
			)
			.toArray()

		const corporationRows = await this.ctx.storage.sql
			.exec<{ next_update_at: number }>(
				'SELECT next_update_at FROM corporations ORDER BY next_update_at ASC LIMIT 1'
			)
			.toArray()

		const times: number[] = []
		if (characterRows.length > 0) times.push(characterRows[0].next_update_at)
		if (corporationRows.length > 0) times.push(corporationRows[0].next_update_at)

		if (times.length === 0) {
			// No entities to update
			return
		}

		const earliestUpdate = Math.min(...times)

		// Schedule alarm (don't schedule in the past)
		const alarmTime = Math.max(earliestUpdate, now + 1000)

		await this.ctx.storage.setAlarm(alarmTime)
		this.alarmScheduled = true

		logger.info('Scheduled character/corporation update alarm', {
			alarmTime: new Date(alarmTime).toISOString(),
			delaySeconds: Math.round((alarmTime - now) / 1000),
		})
	}

	async alarm(): Promise<void> {
		this.alarmScheduled = false

		logger
			.withTags({
				type: 'character_data_alarm',
			})
			.info('Character data update alarm triggered')

		try {
			await this.ensureSchema()

			const { characters, corporations } = await this.getEntitiesNeedingUpdate()

			logger.info('Processing character/corporation updates', {
				characterCount: characters.length,
				corporationCount: corporations.length,
			})

			// Get UserTokenStore for accessing tokens
			const tokenStore = getStub<UserTokenStore>(this.env.USER_TOKEN_STORE, 'global')

			// Update characters
			for (const { character_id } of characters) {
				try {
					// Get access token for this character
					const tokenInfo = await tokenStore.getAccessToken(character_id)
					const { data, expiresAt } = await fetchCharacterInfo(character_id, tokenInfo.accessToken)
					await this.upsertCharacter(character_id, data, expiresAt)

					// Also update their corporation if we haven't seen it before
					const corp = await this.getCorporation(data.corporation_id)
					if (!corp) {
						try {
							const corpData = await fetchCorporationInfo(data.corporation_id, tokenInfo.accessToken)
							await this.upsertCorporation(data.corporation_id, corpData.data, corpData.expiresAt)
						} catch (corpError) {
							logger.error('Failed to fetch corporation during character update', {
								corporationId: data.corporation_id,
								error: String(corpError),
							})
						}
					}
				} catch (error) {
					logger.error('Failed to update character', {
						characterId: character_id,
						error: String(error),
					})
				}
			}

			// Update corporations (use any available token, or fetch without auth since it's public)
			for (const { corporation_id } of corporations) {
				try {
					const { data, expiresAt } = await fetchCorporationInfo(corporation_id)
					await this.upsertCorporation(corporation_id, data, expiresAt)
				} catch (error) {
					logger.error('Failed to update corporation', {
						corporationId: corporation_id,
						error: String(error),
					})
				}
			}

			// Schedule next alarm
			await this.scheduleNextAlarm()
		} catch (error) {
			logger.error('Character data alarm processing failed', {
				error: String(error),
			})

			// Reschedule alarm in 5 minutes on error
			const retryTime = Date.now() + 5 * 60 * 1000
			await this.ctx.storage.setAlarm(retryTime)
			this.alarmScheduled = true

			logger.info('Rescheduled alarm after error', {
				retryTime: new Date(retryTime).toISOString(),
			})
		}
	}
}
