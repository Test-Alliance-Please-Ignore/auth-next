import { DurableObject } from 'cloudflare:workers'

import { loadMigrationsFromBuild, MigratableDurableObject } from '@repo/do-migrations'
import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

import {
	fetchAllianceInfo,
	fetchCharacterCorporationHistory,
	fetchCharacterInfo,
	fetchCharacterSkillQueue,
	fetchCharacterSkills,
	fetchCorporationInfo,
} from './esi-client'
import { characterDataStoreMigrations } from './migrations'

import type { EveSSO } from '@repo/evesso'
import type { SessionStore } from '@repo/session-store'
import type { TagStore } from '@repo/tag-store'
import type { Env } from './context'
import type {
	ESICharacterInfo,
	ESICharacterSkillQueue,
	ESICharacterSkills,
	ESICorporationHistory,
	ESICorporationInfo,
} from './esi-client'

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

export interface CharacterSkillsData extends Record<string, number | string | null> {
	character_id: number
	total_sp: number
	unallocated_sp: number
	last_updated: number
	next_update_at: number
	update_count: number
}

export interface SkillData extends Record<string, number | string | null> {
	character_id: number
	skill_id: number
	skillpoints_in_skill: number
	trained_skill_level: number
	active_skill_level: number
}

export interface SkillQueueData extends Record<string, number | string | null> {
	character_id: number
	skill_id: number
	finished_level: number
	queue_position: number
	start_date: string | null
	finish_date: string | null
	training_start_sp: number | null
	level_start_sp: number | null
	level_end_sp: number | null
}

export interface CorporationHistoryData extends Record<string, number | string | null> {
	character_id: number
	record_id: number
	corporation_id: number
	corporation_name: string | null
	corporation_ticker: string | null
	alliance_id: number | null
	alliance_name: string | null
	alliance_ticker: string | null
	start_date: string
	end_date: string | null
	is_deleted: boolean
}

export class CharacterDataStore extends MigratableDurableObject {
	private alarmScheduled = false

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env, {
			migrationDir: 'CharacterDataStore',
			autoMigrate: true,
			verbose: env.ENVIRONMENT === 'development',
		})
	}

	/**
	 * Override loadMigrations to provide the embedded SQL files
	 */
	protected async loadMigrations() {
		return loadMigrationsFromBuild(characterDataStoreMigrations)
	}

	private async ensureSkillTables(): Promise<void> {
		try {
			// Check if character_skills table exists
			const result = await this.ctx.storage.sql
				.exec(`SELECT name FROM sqlite_master WHERE type='table' AND name='character_skills'`)
				.toArray()

			if (result.length === 0) {
				logger.info('Skill tables not found, creating them...')

				// Character skills aggregate table
				await this.ctx.storage.sql.exec(`
					CREATE TABLE IF NOT EXISTS character_skills (
						character_id INTEGER PRIMARY KEY,
						total_sp INTEGER NOT NULL,
						unallocated_sp INTEGER NOT NULL DEFAULT 0,
						last_updated INTEGER NOT NULL,
						next_update_at INTEGER NOT NULL,
						update_count INTEGER NOT NULL DEFAULT 0
					)
				`)

				await this.ctx.storage.sql.exec(`
					CREATE INDEX IF NOT EXISTS idx_character_skills_next_update ON character_skills(next_update_at)
				`)

				// Individual skills table
				await this.ctx.storage.sql.exec(`
					CREATE TABLE IF NOT EXISTS skills (
						character_id INTEGER NOT NULL,
						skill_id INTEGER NOT NULL,
						skillpoints_in_skill INTEGER NOT NULL,
						trained_skill_level INTEGER NOT NULL,
						active_skill_level INTEGER NOT NULL,
						PRIMARY KEY (character_id, skill_id)
					)
				`)

				await this.ctx.storage.sql.exec(`
					CREATE INDEX IF NOT EXISTS idx_skills_character ON skills(character_id)
				`)

				// Skill queue table
				await this.ctx.storage.sql.exec(`
					CREATE TABLE IF NOT EXISTS skillqueue (
						character_id INTEGER NOT NULL,
						skill_id INTEGER NOT NULL,
						finished_level INTEGER NOT NULL,
						queue_position INTEGER NOT NULL,
						start_date TEXT,
						finish_date TEXT,
						training_start_sp INTEGER,
						level_start_sp INTEGER,
						level_end_sp INTEGER,
						PRIMARY KEY (character_id, queue_position)
					)
				`)

				await this.ctx.storage.sql.exec(`
					CREATE INDEX IF NOT EXISTS idx_skillqueue_character ON skillqueue(character_id)
				`)

				logger.info('Skill tables created successfully')
			}
		} catch (error) {
			logger.error('Error checking/creating skill tables', { error: String(error) })
			// Continue anyway - the tables might exist in a different format
		}
	}

	private async ensureCorporationHistoryTable(): Promise<void> {
		try {
			// Check if corporation_history table exists
			const historyTableResult = await this.ctx.storage.sql
				.exec(`SELECT name FROM sqlite_master WHERE type='table' AND name='corporation_history'`)
				.toArray()

			if (historyTableResult.length === 0) {
				logger.info('Corporation history table not found, creating it...')

				// Corporation history table
				await this.ctx.storage.sql.exec(`
					CREATE TABLE IF NOT EXISTS corporation_history (
						character_id INTEGER NOT NULL,
						record_id INTEGER NOT NULL,
						corporation_id INTEGER NOT NULL,
						corporation_name TEXT,
						corporation_ticker TEXT,
						alliance_id INTEGER,
						alliance_name TEXT,
						alliance_ticker TEXT,
						start_date TEXT NOT NULL,
						end_date TEXT,
						is_deleted INTEGER NOT NULL DEFAULT 0,
						last_updated INTEGER NOT NULL DEFAULT 0,
						PRIMARY KEY (character_id, record_id)
					)
				`)

				await this.ctx.storage.sql.exec(`
					CREATE INDEX IF NOT EXISTS idx_corp_history_character ON corporation_history(character_id)
				`)

				await this.ctx.storage.sql.exec(`
					CREATE INDEX IF NOT EXISTS idx_corp_history_dates ON corporation_history(start_date, end_date)
				`)

				logger.info('Corporation history table created successfully')
			}

			// Always check and create metadata table separately (for existing instances)
			const metadataTableResult = await this.ctx.storage.sql
				.exec(
					`SELECT name FROM sqlite_master WHERE type='table' AND name='corporation_history_metadata'`
				)
				.toArray()

			if (metadataTableResult.length === 0) {
				logger.info('Corporation history metadata table not found, creating it...')

				await this.ctx.storage.sql.exec(`
					CREATE TABLE IF NOT EXISTS corporation_history_metadata (
						character_id INTEGER PRIMARY KEY,
						last_fetched INTEGER NOT NULL,
						next_fetch_at INTEGER NOT NULL
					)
				`)

				logger.info('Corporation history metadata table created successfully')
			}
		} catch (error) {
			logger.error('Error checking/creating corporation history table', { error: String(error) })
			// Continue anyway - the tables might exist in a different format
		}
	}

	private async createSchema(): Promise<void> {
		// Drop all tables if they exist
		await this.ctx.storage.sql.exec('DROP TABLE IF EXISTS skillqueue')
		await this.ctx.storage.sql.exec('DROP TABLE IF EXISTS skills')
		await this.ctx.storage.sql.exec('DROP TABLE IF EXISTS character_skills')
		await this.ctx.storage.sql.exec('DROP TABLE IF EXISTS character_history')
		await this.ctx.storage.sql.exec('DROP TABLE IF EXISTS characters')
		await this.ctx.storage.sql.exec('DROP TABLE IF EXISTS corporations')

		// Characters table
		await this.ctx.storage.sql.exec(`
			CREATE TABLE characters (
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
			CREATE INDEX idx_characters_next_update ON characters(next_update_at)
		`)

		await this.ctx.storage.sql.exec(`
			CREATE INDEX idx_characters_corporation ON characters(corporation_id)
		`)

		// Corporations table
		await this.ctx.storage.sql.exec(`
			CREATE TABLE corporations (
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
			CREATE INDEX idx_corporations_next_update ON corporations(next_update_at)
		`)

		// Character history table for tracking changes
		await this.ctx.storage.sql.exec(`
			CREATE TABLE character_history (
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
			CREATE INDEX idx_history_character ON character_history(character_id, changed_at)
		`)

		// Character skills aggregate table
		await this.ctx.storage.sql.exec(`
			CREATE TABLE character_skills (
				character_id INTEGER PRIMARY KEY,
				total_sp INTEGER NOT NULL,
				unallocated_sp INTEGER NOT NULL DEFAULT 0,
				last_updated INTEGER NOT NULL,
				next_update_at INTEGER NOT NULL,
				update_count INTEGER NOT NULL DEFAULT 0,
				FOREIGN KEY (character_id) REFERENCES characters(character_id) ON DELETE CASCADE
			)
		`)

		await this.ctx.storage.sql.exec(`
			CREATE INDEX idx_character_skills_next_update ON character_skills(next_update_at)
		`)

		// Individual skills table
		await this.ctx.storage.sql.exec(`
			CREATE TABLE skills (
				character_id INTEGER NOT NULL,
				skill_id INTEGER NOT NULL,
				skillpoints_in_skill INTEGER NOT NULL,
				trained_skill_level INTEGER NOT NULL,
				active_skill_level INTEGER NOT NULL,
				PRIMARY KEY (character_id, skill_id),
				FOREIGN KEY (character_id) REFERENCES characters(character_id) ON DELETE CASCADE
			)
		`)

		await this.ctx.storage.sql.exec(`
			CREATE INDEX idx_skills_character ON skills(character_id)
		`)

		// Skill queue table
		await this.ctx.storage.sql.exec(`
			CREATE TABLE skillqueue (
				character_id INTEGER NOT NULL,
				skill_id INTEGER NOT NULL,
				finished_level INTEGER NOT NULL,
				queue_position INTEGER NOT NULL,
				start_date TEXT,
				finish_date TEXT,
				training_start_sp INTEGER,
				level_start_sp INTEGER,
				level_end_sp INTEGER,
				PRIMARY KEY (character_id, queue_position),
				FOREIGN KEY (character_id) REFERENCES characters(character_id) ON DELETE CASCADE
			)
		`)

		await this.ctx.storage.sql.exec(`
			CREATE INDEX idx_skillqueue_character ON skillqueue(character_id)
		`)
	}

	async upsertCharacter(
		characterId: number,
		data: ESICharacterInfo,
		expiresAt: number | null
	): Promise<CharacterData> {

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

		// Upsert tags for this character (corporation and alliance)
		await this.upsertCharacterTags(characterId, data.corporation_id, data.alliance_id || null)

		return stored[0]
	}

	/**
	 * Upsert corporation and alliance tags when character data is refreshed
	 */
	private async upsertCharacterTags(
		characterId: number,
		corporationId: number,
		allianceId: number | null
	): Promise<void> {
		try {
			// Find the root user who owns this character
			const sessionStoreStub = getStub<SessionStore>(this.env.USER_SESSION_STORE, 'global')
			const characterLink = await sessionStoreStub.getCharacterLinkByCharacterId(characterId)

			if (!characterLink) {
				// Character not linked to any user, skip tag upserting
				logger.debug('Character not linked to any user, skipping tag upsert', {
					characterId,
				})
				return
			}

			const rootUserId = characterLink.rootUserId

			// Get TagStore stub
			const tagStoreStub = getStub<TagStore>(this.env.TAG_STORE, 'global')

			// Fetch corporation data to get name and alliance info
			const corpData = await this.getCorporation(corporationId)
			if (!corpData) {
				logger.warn('Corporation data not found for tag upsert', {
					characterId,
					corporationId,
				})
				return
			}

			// Upsert corporation tag
			const corpUrn = `urn:eve:corporation:${corporationId}`
			await tagStoreStub.upsertTag(corpUrn, 'corporation', corpData.name, corporationId, {
				corporationId,
				ticker: corpData.ticker,
			})

			// Assign corporation tag to user
			await tagStoreStub.assignTagToUser(rootUserId, corpUrn, characterId)

			logger.info('Upserted corporation tag on character refresh', {
				characterId,
				corporationId,
				corporationName: corpData.name,
				corporationTicker: corpData.ticker,
				rootUserId: rootUserId.substring(0, 8) + '...',
			})

			// Upsert alliance tag if applicable
			if (allianceId && corpData.alliance_id) {
				try {
					// Fetch alliance info from ESI
					const { data: allianceData } = await fetchAllianceInfo(allianceId)

					const allianceUrn = `urn:eve:alliance:${allianceId}`

					await tagStoreStub.upsertTag(allianceUrn, 'alliance', allianceData.name, allianceId, {
						allianceId,
						ticker: allianceData.ticker,
					})

					// Assign alliance tag to user
					await tagStoreStub.assignTagToUser(rootUserId, allianceUrn, characterId)

					logger.info('Upserted alliance tag on character refresh', {
						characterId,
						allianceId,
						allianceName: allianceData.name,
						rootUserId: rootUserId.substring(0, 8) + '...',
					})
				} catch (allianceError) {
					logger.error('Failed to fetch alliance info for tag upsert', {
						characterId,
						allianceId,
						error: String(allianceError),
					})
					// Fallback to placeholder if ESI fetch fails
					const allianceUrn = `urn:eve:alliance:${allianceId}`
					const allianceName = `Alliance ${allianceId}`

					await tagStoreStub.upsertTag(allianceUrn, 'alliance', allianceName, allianceId, {
						allianceId,
					})

					await tagStoreStub.assignTagToUser(rootUserId, allianceUrn, characterId)
				}
			}
		} catch (error) {
			// Don't fail the character update if tag upserting fails
			logger.error('Failed to upsert tags on character refresh', {
				characterId,
				corporationId,
				allianceId,
				error: String(error),
			})
		}
	}

	async upsertCorporation(
		corporationId: number,
		data: ESICorporationInfo,
		expiresAt: number | null
	): Promise<CorporationData> {

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

		const rows = await this.ctx.storage.sql
			.exec<CharacterData>('SELECT * FROM characters WHERE character_id = ?', characterId)
			.toArray()

		return rows.length > 0 ? rows[0] : null
	}

	async getCorporation(corporationId: number): Promise<CorporationData | null> {

		const rows = await this.ctx.storage.sql
			.exec<CorporationData>('SELECT * FROM corporations WHERE corporation_id = ?', corporationId)
			.toArray()

		return rows.length > 0 ? rows[0] : null
	}

	async getCharacterHistory(characterId: number): Promise<ChangeHistoryEntry[]> {

		const rows = await this.ctx.storage.sql
			.exec<ChangeHistoryEntry>(
				'SELECT * FROM character_history WHERE character_id = ? ORDER BY changed_at DESC LIMIT 100',
				characterId
			)
			.toArray()

		return rows
	}

	async upsertCharacterSkills(
		characterId: number,
		data: ESICharacterSkills,
		expiresAt: number | null
	): Promise<CharacterSkillsData> {

		const now = Date.now()
		const nextUpdateAt = expiresAt || now + 3600 * 1000 // Default 1 hour if no cache header

		// Check for existing character skills
		const existing = await this.ctx.storage.sql
			.exec<CharacterSkillsData>(
				'SELECT * FROM character_skills WHERE character_id = ?',
				characterId
			)
			.toArray()

		const isUpdate = existing.length > 0

		if (isUpdate) {
			// Update existing character skills
			await this.ctx.storage.sql.exec(
				`UPDATE character_skills
				SET total_sp = ?, unallocated_sp = ?, last_updated = ?,
					next_update_at = ?, update_count = update_count + 1
				WHERE character_id = ?`,
				data.total_sp,
				data.unallocated_sp || 0,
				now,
				nextUpdateAt,
				characterId
			)
		} else {
			// Insert new character skills
			await this.ctx.storage.sql.exec(
				`INSERT INTO character_skills (
					character_id, total_sp, unallocated_sp, last_updated,
					next_update_at, update_count
				) VALUES (?, ?, ?, ?, ?, 1)`,
				characterId,
				data.total_sp,
				data.unallocated_sp || 0,
				now,
				nextUpdateAt
			)
		}

		// Delete existing skills and insert new ones
		await this.ctx.storage.sql.exec('DELETE FROM skills WHERE character_id = ?', characterId)

		for (const skill of data.skills) {
			await this.ctx.storage.sql.exec(
				`INSERT INTO skills (
					character_id, skill_id, skillpoints_in_skill,
					trained_skill_level, active_skill_level
				) VALUES (?, ?, ?, ?, ?)`,
				characterId,
				skill.skill_id,
				skill.skillpoints_in_skill,
				skill.trained_skill_level,
				skill.active_skill_level
			)
		}

		logger
			.withTags({
				type: isUpdate ? 'character_skills_updated' : 'character_skills_created',
				character_id: characterId,
			})
			.info(`Character skills ${isUpdate ? 'updated' : 'created'}`, {
				characterId,
				totalSP: data.total_sp,
				unallocatedSP: data.unallocated_sp,
				skillCount: data.skills.length,
				nextUpdateAt: new Date(nextUpdateAt).toISOString(),
			})

		// Return the stored character skills data
		const stored = await this.ctx.storage.sql
			.exec<CharacterSkillsData>(
				'SELECT * FROM character_skills WHERE character_id = ?',
				characterId
			)
			.toArray()

		return stored[0]
	}

	async upsertCharacterSkillQueue(
		characterId: number,
		data: ESICharacterSkillQueue
	): Promise<void> {

		// Delete existing skillqueue and insert new ones
		await this.ctx.storage.sql.exec('DELETE FROM skillqueue WHERE character_id = ?', characterId)

		for (const item of data) {
			await this.ctx.storage.sql.exec(
				`INSERT INTO skillqueue (
					character_id, skill_id, finished_level, queue_position,
					start_date, finish_date, training_start_sp, level_start_sp, level_end_sp
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				characterId,
				item.skill_id,
				item.finished_level,
				item.queue_position,
				item.start_date || null,
				item.finish_date || null,
				item.training_start_sp || null,
				item.level_start_sp || null,
				item.level_end_sp || null
			)
		}

		logger
			.withTags({
				type: 'character_skillqueue_updated',
				character_id: characterId,
			})
			.info('Character skillqueue updated', {
				characterId,
				queueLength: data.length,
			})
	}

	async getCharacterSkills(characterId: number): Promise<CharacterSkillsData | null> {

		const rows = await this.ctx.storage.sql
			.exec<CharacterSkillsData>(
				'SELECT * FROM character_skills WHERE character_id = ?',
				characterId
			)
			.toArray()

		return rows.length > 0 ? rows[0] : null
	}

	async getSkills(characterId: number): Promise<SkillData[]> {

		const rows = await this.ctx.storage.sql
			.exec<SkillData>('SELECT * FROM skills WHERE character_id = ? ORDER BY skill_id', characterId)
			.toArray()

		return rows
	}

	async getSkillQueue(characterId: number): Promise<SkillQueueData[]> {

		const rows = await this.ctx.storage.sql
			.exec<SkillQueueData>(
				'SELECT * FROM skillqueue WHERE character_id = ? ORDER BY queue_position',
				characterId
			)
			.toArray()

		return rows
	}

	async upsertCorporationHistory(
		characterId: number,
		history: ESICorporationHistory
	): Promise<void> {

		const now = Date.now()

		// Process history entries
		const sortedHistory = [...history].sort(
			(a, b) => new Date(a.start_date).getTime() - new Date(b.start_date).getTime()
		)

		for (let i = 0; i < sortedHistory.length; i++) {
			const entry = sortedHistory[i]
			const nextEntry = sortedHistory[i + 1]

			// Try to get corporation info if we don't have the name
			let corpName: string | null = null
			let corpTicker: string | null = null
			let allianceId: number | null = null
			let allianceName: string | null = null
			let allianceTicker: string | null = null

			// Get corporation info if not deleted
			if (!entry.is_deleted) {
				const corpData = await this.getCorporation(entry.corporation_id)
				if (corpData) {
					corpName = corpData.name
					corpTicker = corpData.ticker
					allianceId = corpData.alliance_id

					// Get alliance info if exists
					if (allianceId) {
						try {
							const allianceData = await fetchAllianceInfo(allianceId)
							allianceName = allianceData.data.name
							allianceTicker = allianceData.data.ticker
						} catch (error) {
							logger.error('Failed to fetch alliance info for history', {
								allianceId,
								error: String(error),
							})
						}
					}
				}
			}

			await this.ctx.storage.sql.exec(
				`INSERT OR REPLACE INTO corporation_history
				(character_id, record_id, corporation_id, corporation_name, corporation_ticker,
				 alliance_id, alliance_name, alliance_ticker, start_date, end_date, is_deleted, last_updated)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				characterId,
				entry.record_id,
				entry.corporation_id,
				corpName,
				corpTicker,
				allianceId,
				allianceName,
				allianceTicker,
				entry.start_date,
				nextEntry ? nextEntry.start_date : null, // End date is start of next entry
				entry.is_deleted ? 1 : 0,
				now
			)
		}

		logger.info('Corporation history updated', {
			characterId,
			historyCount: history.length,
		})
	}

	async getCorporationHistory(characterId: number): Promise<CorporationHistoryData[]> {

		const rows = await this.ctx.storage.sql
			.exec<CorporationHistoryData>(
				`SELECT * FROM corporation_history
				WHERE character_id = ?
				ORDER BY start_date DESC`,
				characterId
			)
			.toArray()

		// Convert is_deleted from number to boolean
		return rows.map((row) => ({
			...row,
			is_deleted: row.is_deleted === 1,
		}))
	}

	async fetchAndStoreCorporationHistory(characterId: number): Promise<CorporationHistoryData[]> {

		const now = Date.now()
		const cacheTime = 24 * 60 * 60 * 1000 // Cache for 24 hours

		// Check if we have cached data and if it's still fresh
		const metadataRows = await this.ctx.storage.sql
			.exec<{
				last_fetched: number
				next_fetch_at: number
			}>('SELECT last_fetched, next_fetch_at FROM corporation_history_metadata WHERE character_id = ?', characterId)
			.toArray()

		// If we have fresh cached data, return it
		if (metadataRows.length > 0 && metadataRows[0].next_fetch_at > now) {
			logger.info('Returning cached corporation history', {
				characterId,
				lastFetched: new Date(metadataRows[0].last_fetched).toISOString(),
				nextFetchAt: new Date(metadataRows[0].next_fetch_at).toISOString(),
			})
			return this.getCorporationHistory(characterId)
		}

		try {
			// Fetch from ESI
			const { data, expiresAt } = await fetchCharacterCorporationHistory(characterId)

			// Store in database
			await this.upsertCorporationHistory(characterId, data)

			// Update metadata
			const nextFetchAt = expiresAt || now + cacheTime
			await this.ctx.storage.sql.exec(
				`INSERT OR REPLACE INTO corporation_history_metadata
				(character_id, last_fetched, next_fetch_at)
				VALUES (?, ?, ?)`,
				characterId,
				now,
				nextFetchAt
			)

			logger.info('Corporation history fetched and cached', {
				characterId,
				historyCount: data.length,
				nextFetchAt: new Date(nextFetchAt).toISOString(),
			})

			// Return the stored data
			return this.getCorporationHistory(characterId)
		} catch (error) {
			logger.error('Failed to fetch and store corporation history', {
				characterId,
				error: String(error),
			})

			// Return whatever we have cached
			return this.getCorporationHistory(characterId)
		}
	}

	private async getEntitiesNeedingUpdate(): Promise<{
		characters: Array<{ character_id: number }>
		corporations: Array<{ corporation_id: number }>
	}> {

		const now = Date.now()

		const characters = await this.ctx.storage.sql
			.exec<{
				character_id: number
			}>('SELECT character_id FROM characters WHERE next_update_at <= ? LIMIT 50', now)
			.toArray()

		const corporations = await this.ctx.storage.sql
			.exec<{
				corporation_id: number
			}>('SELECT corporation_id FROM corporations WHERE next_update_at <= ? LIMIT 50', now)
			.toArray()

		return { characters, corporations }
	}

	private async scheduleNextAlarm(): Promise<void> {
		// Only schedule one alarm at a time
		if (this.alarmScheduled) {
			return
		}


		const now = Date.now()

		// Find the earliest next_update_at from both characters and corporations
		const characterRows = await this.ctx.storage.sql
			.exec<{
				next_update_at: number
			}>('SELECT next_update_at FROM characters ORDER BY next_update_at ASC LIMIT 1')
			.toArray()

		const corporationRows = await this.ctx.storage.sql
			.exec<{
				next_update_at: number
			}>('SELECT next_update_at FROM corporations ORDER BY next_update_at ASC LIMIT 1')
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
	
			const { characters, corporations } = await this.getEntitiesNeedingUpdate()

			logger.info('Processing character/corporation updates', {
				characterCount: characters.length,
				corporationCount: corporations.length,
			})

			// Get EveSSO store for accessing tokens
			const tokenStore = getStub<EveSSO>(this.env.EVESSO_STORE, 'global')

			// Update characters
			for (const { character_id } of characters) {
				try {
					// Get access token for this character
					const tokenInfo = await tokenStore.getAccessToken(character_id)
					const { data, expiresAt } = await fetchCharacterInfo(character_id, tokenInfo.accessToken)
					await this.upsertCharacter(character_id, data, expiresAt)

					// Fetch and store character skills
					try {
						const skillsData = await fetchCharacterSkills(character_id, tokenInfo.accessToken)
						await this.upsertCharacterSkills(character_id, skillsData.data, skillsData.expiresAt)
					} catch (skillsError) {
						logger.error('Failed to fetch skills during character update', {
							characterId: character_id,
							error: String(skillsError),
						})
					}

					// Fetch and store character skillqueue
					try {
						const skillqueueData = await fetchCharacterSkillQueue(
							character_id,
							tokenInfo.accessToken
						)
						await this.upsertCharacterSkillQueue(character_id, skillqueueData.data)
					} catch (skillqueueError) {
						logger.error('Failed to fetch skillqueue during character update', {
							characterId: character_id,
							error: String(skillqueueError),
						})
					}

					// Also update their corporation if we haven't seen it before
					const corp = await this.getCorporation(data.corporation_id)
					if (!corp) {
						try {
							const corpData = await fetchCorporationInfo(
								data.corporation_id,
								tokenInfo.accessToken
							)
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
