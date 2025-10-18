import { DurableObject } from 'cloudflare:workers'

import { loadMigrationsFromBuild, MigratableDurableObject } from '@repo/do-migrations'
import { logger } from '@repo/hono-helpers'

import { tagStoreMigrations } from './migrations'

import type { Env } from './context'

// ========== Type Definitions ==========

export interface TagData extends Record<string, number | string> {
	tag_urn: string
	tag_type: string
	display_name: string
	eve_id: number
	metadata: string
	created_at: number
	updated_at: number
}

export interface Tag {
	tagUrn: string
	tagType: 'corporation' | 'alliance'
	displayName: string
	eveId: number
	metadata: Record<string, unknown> | null
	color: string // 'green' for corporation, 'blue' for alliance
	createdAt: number
	updatedAt: number
}

export interface UserTagData extends Record<string, number | string> {
	assignment_id: string
	root_user_id: string
	tag_urn: string
	source_character_id: number
	assigned_at: number
	last_verified_at: number
}

export interface UserTag {
	assignmentId: string
	rootUserId: string
	tagUrn: string
	sourceCharacterId: number
	assignedAt: number
	lastVerifiedAt: number
}

export interface TagWithSources extends Tag {
	sourceCharacters: number[]
}

export class TagStore extends MigratableDurableObject {
	private readonly EVALUATION_INTERVAL_MS = 60 * 60 * 1000 // 1 hour
	private readonly BATCH_SIZE = 100 // Process 100 users per alarm

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env, {
			migrationDir: 'TagStore',
			autoMigrate: true,
			verbose: env.ENVIRONMENT === 'development',
		})
	}

	/**
	 * Override loadMigrations to provide the embedded SQL files
	 */
	protected async loadMigrations() {
		return loadMigrationsFromBuild(tagStoreMigrations)
	}

	private async createSchema(): Promise<void> {
		logger
			.withTags({
				type: 'tagstore_create_schema_start',
			})
			.info('Creating TagStore schema tables')

		// Tags table
		await this.ctx.storage.sql.exec(`
			CREATE TABLE IF NOT EXISTS tags (
				tag_urn TEXT PRIMARY KEY,
				tag_type TEXT NOT NULL,
				display_name TEXT NOT NULL,
				eve_id INTEGER NOT NULL,
				metadata TEXT,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL
			)
		`)

		logger
			.withTags({
				type: 'tagstore_table_created',
			})
			.info('TagStore table created: tags')

		await this.ctx.storage.sql.exec(`
			CREATE INDEX IF NOT EXISTS idx_tags_type ON tags(tag_type)
		`)

		await this.ctx.storage.sql.exec(`
			CREATE INDEX IF NOT EXISTS idx_tags_eve_id ON tags(eve_id)
		`)

		// User tag assignments
		await this.ctx.storage.sql.exec(`
			CREATE TABLE IF NOT EXISTS user_tags (
				assignment_id TEXT PRIMARY KEY,
				root_user_id TEXT NOT NULL,
				tag_urn TEXT NOT NULL,
				source_character_id INTEGER NOT NULL,
				assigned_at INTEGER NOT NULL,
				last_verified_at INTEGER NOT NULL,
				UNIQUE(root_user_id, tag_urn, source_character_id)
			)
		`)

		logger
			.withTags({
				type: 'tagstore_table_created',
			})
			.info('TagStore table created: user_tags')

		await this.ctx.storage.sql.exec(`
			CREATE INDEX IF NOT EXISTS idx_user_tags_user ON user_tags(root_user_id)
		`)

		await this.ctx.storage.sql.exec(`
			CREATE INDEX IF NOT EXISTS idx_user_tags_character ON user_tags(source_character_id)
		`)

		await this.ctx.storage.sql.exec(`
			CREATE INDEX IF NOT EXISTS idx_user_tags_urn ON user_tags(tag_urn)
		`)

		// Evaluation schedule
		await this.ctx.storage.sql.exec(`
			CREATE TABLE IF NOT EXISTS evaluation_schedule (
				root_user_id TEXT PRIMARY KEY,
				next_evaluation_at INTEGER NOT NULL,
				last_evaluated_at INTEGER
			)
		`)

		logger
			.withTags({
				type: 'tagstore_table_created',
			})
			.info('TagStore table created: evaluation_schedule')

		await this.ctx.storage.sql.exec(`
			CREATE INDEX IF NOT EXISTS idx_evaluation_schedule_next ON evaluation_schedule(next_evaluation_at)
		`)

		logger
			.withTags({
				type: 'tagstore_create_schema_complete',
			})
			.info('TagStore schema tables and indexes created successfully')
	}

	private generateId(): string {
		return crypto.randomUUID()
	}

	private getTagColor(tagType: string): string {
		switch (tagType) {
			case 'corporation':
				return 'green'
			case 'alliance':
				return 'blue'
			default:
				return 'gray'
		}
	}

	// ========== Tag CRUD ==========

	async upsertTag(
		urn: string,
		tagType: 'corporation' | 'alliance',
		displayName: string,
		eveId: number,
		metadata?: Record<string, unknown>
	): Promise<Tag> {

		const now = Date.now()
		const existing = await this.getTag(urn)

		if (existing) {
			// Update existing tag
			await this.ctx.storage.sql.exec(
				'UPDATE tags SET display_name = ?, metadata = ?, updated_at = ? WHERE tag_urn = ?',
				displayName,
				metadata ? JSON.stringify(metadata) : '',
				now,
				urn
			)
		} else {
			// Insert new tag
			await this.ctx.storage.sql.exec(
				`INSERT INTO tags (tag_urn, tag_type, display_name, eve_id, metadata, created_at, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, ?)`,
				urn,
				tagType,
				displayName,
				eveId,
				metadata ? JSON.stringify(metadata) : '',
				now,
				now
			)
		}

		logger.withTags({ type: 'tag_upserted' }).info('Tag upserted', {
			urn,
			tagType,
			displayName,
		})

		return {
			tagUrn: urn,
			tagType,
			displayName,
			eveId,
			metadata: metadata || null,
			color: this.getTagColor(tagType),
			createdAt: existing?.createdAt || now,
			updatedAt: now,
		}
	}

	async getTag(urn: string): Promise<Tag | null> {

		const rows = await this.ctx.storage.sql
			.exec<TagData>('SELECT * FROM tags WHERE tag_urn = ?', urn)
			.toArray()

		if (rows.length === 0) {
			return null
		}

		const row = rows[0]
		return {
			tagUrn: row.tag_urn,
			tagType: row.tag_type as 'corporation' | 'alliance',
			displayName: row.display_name,
			eveId: row.eve_id,
			metadata: row.metadata ? JSON.parse(row.metadata) : null,
			color: this.getTagColor(row.tag_type),
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		}
	}

	async listAllTags(): Promise<Tag[]> {

		const rows = await this.ctx.storage.sql
			.exec<TagData>('SELECT * FROM tags ORDER BY display_name ASC')
			.toArray()

		return rows.map((row) => ({
			tagUrn: row.tag_urn,
			tagType: row.tag_type as 'corporation' | 'alliance',
			displayName: row.display_name,
			eveId: row.eve_id,
			metadata: row.metadata ? JSON.parse(row.metadata) : null,
			color: this.getTagColor(row.tag_type),
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		}))
	}

	// ========== User Tag Assignment ==========

	async assignTagToUser(userId: string, tagUrn: string, characterId: number): Promise<void> {

		const assignmentId = this.generateId()
		const now = Date.now()

		// Use INSERT OR IGNORE to handle existing assignments
		await this.ctx.storage.sql.exec(
			`INSERT OR IGNORE INTO user_tags
			(assignment_id, root_user_id, tag_urn, source_character_id, assigned_at, last_verified_at)
			VALUES (?, ?, ?, ?, ?, ?)`,
			assignmentId,
			userId,
			tagUrn,
			characterId,
			now,
			now
		)

		// Update last_verified_at if already existed
		await this.ctx.storage.sql.exec(
			`UPDATE user_tags
			SET last_verified_at = ?
			WHERE root_user_id = ? AND tag_urn = ? AND source_character_id = ?`,
			now,
			userId,
			tagUrn,
			characterId
		)

		logger.withTags({ type: 'tag_assigned' }).info('Tag assigned to user', {
			userId: userId.substring(0, 8) + '...',
			tagUrn,
			characterId,
		})
	}

	async removeTagFromUser(userId: string, tagUrn: string, characterId?: number): Promise<void> {

		if (characterId) {
			// Remove specific character's contribution to this tag
			await this.ctx.storage.sql.exec(
				'DELETE FROM user_tags WHERE root_user_id = ? AND tag_urn = ? AND source_character_id = ?',
				userId,
				tagUrn,
				characterId
			)
		} else {
			// Remove all assignments for this tag
			await this.ctx.storage.sql.exec(
				'DELETE FROM user_tags WHERE root_user_id = ? AND tag_urn = ?',
				userId,
				tagUrn
			)
		}

		logger.withTags({ type: 'tag_removed' }).info('Tag removed from user', {
			userId: userId.substring(0, 8) + '...',
			tagUrn,
			characterId,
		})
	}

	async removeAllTagsForCharacter(characterId: number): Promise<void> {

		await this.ctx.storage.sql.exec(
			'DELETE FROM user_tags WHERE source_character_id = ?',
			characterId
		)

		logger.withTags({ type: 'character_tags_removed' }).info('Removed all tags for character', {
			characterId,
		})
	}

	async getUserTags(userId: string): Promise<TagWithSources[]> {

		// Get all unique tags for this user with their source characters
		const rows = await this.ctx.storage.sql
			.exec<TagData & { source_character_ids: string }>(
				`SELECT
					t.*,
					GROUP_CONCAT(ut.source_character_id) as source_character_ids
				FROM tags t
				INNER JOIN user_tags ut ON t.tag_urn = ut.tag_urn
				WHERE ut.root_user_id = ?
				GROUP BY t.tag_urn
				ORDER BY t.display_name ASC`,
				userId
			)
			.toArray()

		return rows.map((row) => ({
			tagUrn: row.tag_urn,
			tagType: row.tag_type as 'corporation' | 'alliance',
			displayName: row.display_name,
			eveId: row.eve_id,
			metadata: row.metadata ? JSON.parse(row.metadata) : null,
			color: this.getTagColor(row.tag_type),
			createdAt: row.created_at,
			updatedAt: row.updated_at,
			sourceCharacters: row.source_character_ids.split(',').map((id) => parseInt(id, 10)),
		}))
	}

	async getUserTagAssignments(userId: string): Promise<UserTag[]> {

		const rows = await this.ctx.storage.sql
			.exec<UserTagData>('SELECT * FROM user_tags WHERE root_user_id = ?', userId)
			.toArray()

		return rows.map((row) => ({
			assignmentId: row.assignment_id,
			rootUserId: row.root_user_id,
			tagUrn: row.tag_urn,
			sourceCharacterId: row.source_character_id,
			assignedAt: row.assigned_at,
			lastVerifiedAt: row.last_verified_at,
		}))
	}

	async getUsersWithTag(tagUrn: string): Promise<string[]> {

		const rows = await this.ctx.storage.sql
			.exec<{
				root_user_id: string
			}>('SELECT DISTINCT root_user_id FROM user_tags WHERE tag_urn = ?', tagUrn)
			.toArray()

		return rows.map((row) => row.root_user_id)
	}

	// ========== Evaluation Scheduling ==========

	async scheduleUserEvaluation(
		userId: string,
		delayMs: number = this.EVALUATION_INTERVAL_MS
	): Promise<void> {

		const now = Date.now()
		const nextEvaluation = now + delayMs

		await this.ctx.storage.sql.exec(
			`INSERT OR REPLACE INTO evaluation_schedule
			(root_user_id, next_evaluation_at, last_evaluated_at)
			VALUES (?, ?, ?)`,
			userId,
			nextEvaluation,
			now
		)

		// Schedule alarm if not already scheduled
		await this.scheduleNextAlarm()
	}

	async getUsersNeedingEvaluation(limit: number = this.BATCH_SIZE): Promise<string[]> {

		const now = Date.now()

		const rows = await this.ctx.storage.sql
			.exec<{
				root_user_id: string
			}>(
				'SELECT root_user_id FROM evaluation_schedule WHERE next_evaluation_at <= ? ORDER BY next_evaluation_at ASC LIMIT ?',
				now,
				limit
			)
			.toArray()

		return rows.map((row) => row.root_user_id)
	}

	async scheduleNextAlarm(): Promise<void> {
		// Get next evaluation time
		const rows = await this.ctx.storage.sql
			.exec<{
				next_evaluation_at: number
			}>('SELECT MIN(next_evaluation_at) as next_evaluation_at FROM evaluation_schedule')
			.toArray()

		if (rows.length === 0 || !rows[0].next_evaluation_at) {
			return
		}

		const nextEvalTime = rows[0].next_evaluation_at
		const now = Date.now()

		// Schedule alarm for the next evaluation time (or now if overdue)
		const alarmTime = Math.max(now, nextEvalTime)

		await this.ctx.storage.setAlarm(alarmTime)

		logger.info('Scheduled next alarm', {
			alarmTime: new Date(alarmTime).toISOString(),
			usersScheduled: rows.length,
		})
	}

	// ========== Tag Evaluation ==========

	async evaluateUserTags(userId: string): Promise<void> {

		const { TagRuleEngine, getUserCharacters } = await import('./tag-rules')

		// Get all user characters
		const characters = await getUserCharacters(userId, this.env)

		if (characters.length === 0) {
			logger.warn('No characters found for user, skipping evaluation', {
				userId: userId.substring(0, 8) + '...',
			})
			return
		}

		// Evaluate all rules
		const ruleEngine = new TagRuleEngine()
		const expectedAssignments = await ruleEngine.evaluateAllRules(userId, {
			characters,
			env: this.env,
		})

		// Build map of expected tags with their source characters
		const expectedTagsMap = new Map<string, Set<number>>() // tagUrn -> Set<characterId>

		for (const assignment of expectedAssignments) {
			// Ensure tag exists in database
			await this.upsertTag(
				assignment.tagUrn,
				assignment.tagType,
				assignment.displayName,
				assignment.eveId,
				assignment.metadata
			)

			// Track expected assignment
			if (!expectedTagsMap.has(assignment.tagUrn)) {
				expectedTagsMap.set(assignment.tagUrn, new Set())
			}
			expectedTagsMap.get(assignment.tagUrn)!.add(assignment.sourceCharacterId)
		}

		// Get current assignments
		const currentAssignments = await this.getUserTagAssignments(userId)

		// Add missing assignments
		for (const [urn, sourceChars] of expectedTagsMap.entries()) {
			for (const charId of sourceChars) {
				const exists = currentAssignments.some(
					(a) => a.tagUrn === urn && a.sourceCharacterId === charId
				)
				if (!exists) {
					await this.assignTagToUser(userId, urn, charId)
				}
			}
		}

		// Remove stale assignments
		for (const assignment of currentAssignments) {
			const expectedSources = expectedTagsMap.get(assignment.tagUrn)
			if (!expectedSources || !expectedSources.has(assignment.sourceCharacterId)) {
				await this.removeTagFromUser(userId, assignment.tagUrn, assignment.sourceCharacterId)
			}
		}

		// Update last evaluated time
		const now = Date.now()
		await this.ctx.storage.sql.exec(
			'UPDATE evaluation_schedule SET last_evaluated_at = ? WHERE root_user_id = ?',
			now,
			userId
		)

		logger.info('User tags evaluated', {
			userId: userId.substring(0, 8) + '...',
			characterCount: characters.length,
			expectedTags: expectedTagsMap.size,
			assignmentsAdded: expectedAssignments.length - currentAssignments.length,
		})
	}

	// ========== Alarm Handler ==========

	async alarm(): Promise<void> {

		logger.info('Tag evaluation alarm triggered')

		// Get batch of users needing evaluation
		const userIds = await this.getUsersNeedingEvaluation()

		if (userIds.length === 0) {
			logger.info('No users need evaluation')
			return
		}

		logger.info('Evaluating users', { count: userIds.length })

		// Evaluate each user
		for (const userId of userIds) {
			try {
				await this.evaluateUserTags(userId)
				// Reschedule for next evaluation
				await this.scheduleUserEvaluation(userId)
			} catch (error) {
				logger.error('Failed to evaluate user tags', {
					userId: userId.substring(0, 8) + '...',
					error: String(error),
				})
			}
		}

		// Schedule next alarm
		await this.scheduleNextAlarm()
	}
}
