import { DurableObject } from 'cloudflare:workers'

import { getStub } from '@repo/do-utils'
import { createWorkflow } from '@repo/workflow-utils'

import type { Discord } from '@repo/discord'
import type { Env } from './context'

type SqlValue = ArrayBuffer | string | number | null

export type TemporaryRoleAssignmentSource = 'self' | 'admin'
export type TemporaryRoleAssignmentStatus = 'active' | 'claimed' | 'removal_pending' | 'failed'

export interface TemporaryRoleAssignment {
	id: string
	guildId: string
	roleId: string
	roleName: string
	discordUserId: string
	coreUserId: string | null
	assignedByCoreUserId: string | null
	assignmentSource: TemporaryRoleAssignmentSource
	assignedAt: number
	expiresAt: number | null
	status: TemporaryRoleAssignmentStatus
	removalReason: string | null
	attemptCount: number
	nextAttemptAt: number | null
	revision: number
}

export interface TemporaryRoleAssignmentInput {
	guildId: string
	roleId: string
	roleName: string
	discordUserId: string
	coreUserId?: string | null
	assignedByCoreUserId?: string | null
	assignmentSource: TemporaryRoleAssignmentSource
	expiresAt: number | null
	interactionId?: string | null
}

export interface TemporaryRoleAssignments {
	listActiveAssignments(
		guildId: string,
		discordUserId?: string,
		coreUserId?: string
	): Promise<TemporaryRoleAssignment[]>
	applyRoleMutation(
		guildId: string,
		input: {
			roleId: string
			discordUserId: string
			action: 'add' | 'remove'
			revision: number
		}
	): Promise<{ success: boolean; error?: string }>
	listPendingRemovalAssignments(
		guildId: string,
		discordUserId?: string,
		coreUserId?: string
	): Promise<TemporaryRoleAssignment[]>
	upsertAssignment(
		guildId: string,
		input: TemporaryRoleAssignmentInput
	): Promise<TemporaryRoleAssignment>
	markRemovalPending(
		guildId: string,
		input: {
			roleId: string
			discordUserId: string
			reason: string
			onlySelf?: boolean
		}
	): Promise<TemporaryRoleAssignment | null>
	completeRemoval(
		guildId: string,
		removals: Array<{ assignmentId: string; revision?: number }>,
		success: boolean,
		errorMessage?: string
	): Promise<void>
	deleteAssignment(guildId: string, assignmentId: string): Promise<void>
	restoreAssignment(
		guildId: string,
		assignmentId: string,
		expectedRevision: number,
		previous: Pick<
			TemporaryRoleAssignment,
			'assignedAt' | 'expiresAt' | 'assignmentSource' | 'coreUserId' | 'assignedByCoreUserId'
		>
	): Promise<void>
	reschedule(guildId: string): Promise<void>
}

const CLAIM_LEASE_MS = 5 * 60 * 1000
const RETRY_DELAY_MS = 60 * 1000
const FAILURE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const REMOVAL_TOMBSTONE_RETENTION_MS = 10 * 60 * 1000
const GUILD_ID_STORAGE_KEY = 'temporary-role-assignments:guild-id'
const CHANGE_CLOCK_STORAGE_KEY = 'temporary-role-assignments:change-clock'

function rowToAssignment(row: Record<string, unknown>): TemporaryRoleAssignment {
	return {
		id: String(row.id),
		guildId: String(row.guild_id),
		roleId: String(row.role_id),
		roleName: String(row.role_name),
		discordUserId: String(row.discord_user_id),
		coreUserId: row.core_user_id ? String(row.core_user_id) : null,
		assignedByCoreUserId: row.assigned_by_core_user_id
			? String(row.assigned_by_core_user_id)
			: null,
		assignmentSource: row.assignment_source === 'admin' ? 'admin' : 'self',
		assignedAt: Number(row.assigned_at),
		expiresAt:
			row.expires_at === null || row.expires_at === undefined ? null : Number(row.expires_at),
		status: String(row.status) as TemporaryRoleAssignmentStatus,
		removalReason: row.removal_reason ? String(row.removal_reason) : null,
		attemptCount: Number(row.attempt_count ?? 0),
		nextAttemptAt:
			row.next_attempt_at === null || row.next_attempt_at === undefined
				? null
				: Number(row.next_attempt_at),
		revision: Number(row.revision ?? 0),
	}
}

export class TemporaryRoleAssignmentsDO
	extends DurableObject<Env>
	implements TemporaryRoleAssignments
{
	constructor(
		public state: DurableObjectState,
		public env: Env
	) {
		super(state, env)
		void state.blockConcurrencyWhile(async () => {
			state.storage.sql.exec(`
				CREATE TABLE IF NOT EXISTS temporary_role_assignments (
					id TEXT PRIMARY KEY,
					guild_id TEXT NOT NULL,
					role_id TEXT NOT NULL,
					role_name TEXT NOT NULL,
					discord_user_id TEXT NOT NULL,
					core_user_id TEXT,
					assigned_by_core_user_id TEXT,
					assignment_source TEXT NOT NULL CHECK (assignment_source IN ('self', 'admin')),
					assigned_at INTEGER NOT NULL,
					expires_at INTEGER,
					status TEXT NOT NULL DEFAULT 'active',
					removal_reason TEXT,
					attempt_count INTEGER NOT NULL DEFAULT 0,
					next_attempt_at INTEGER,
					revision INTEGER NOT NULL DEFAULT 0,
					failure_message TEXT,
					failure_expires_at INTEGER,
					interaction_id TEXT
				)
			`)
			state.storage.sql.exec(
				`CREATE UNIQUE INDEX IF NOT EXISTS temporary_role_assignments_active_key ON temporary_role_assignments (guild_id, role_id, discord_user_id) WHERE status IN ('active', 'claimed', 'removal_pending')`
			)
			state.storage.sql.exec(
				`CREATE UNIQUE INDEX IF NOT EXISTS temporary_role_assignments_interaction_key ON temporary_role_assignments (interaction_id) WHERE interaction_id IS NOT NULL`
			)
			state.storage.sql.exec(
				`CREATE INDEX IF NOT EXISTS temporary_role_assignments_due_idx ON temporary_role_assignments (status, expires_at, next_attempt_at)`
			)
			try {
				state.storage.sql.exec(
					`ALTER TABLE temporary_role_assignments ADD COLUMN revision INTEGER NOT NULL DEFAULT 0`
				)
			} catch {
				// Existing DO instances already have the column.
			}
			await this.rescheduleAlarm()
		})
	}

	private async assertGuild(guildId: string): Promise<void> {
		if (!guildId) {
			throw new Error('Temporary role assignment guild scope mismatch')
		}
		const storedGuildId = await this.state.storage.get<string>(GUILD_ID_STORAGE_KEY)
		if (storedGuildId && storedGuildId !== guildId) {
			throw new Error('Temporary role assignment guild scope mismatch')
		}
		if (!storedGuildId) await this.state.storage.put(GUILD_ID_STORAGE_KEY, guildId)
	}

	private queryRows(sql: string, ...params: SqlValue[]): TemporaryRoleAssignment[] {
		return this.state.storage.sql
			.exec(sql, ...params)
			.toArray()
			.map(rowToAssignment)
	}

	private async nextRevision(): Promise<number> {
		const now = Date.now()
		const previous = (await this.state.storage.get<number>(CHANGE_CLOCK_STORAGE_KEY)) ?? 0
		const revision = Math.max(now, previous + 1)
		await this.state.storage.put(CHANGE_CLOCK_STORAGE_KEY, revision)
		return revision
	}

	async listActiveAssignments(
		guildId: string,
		discordUserId?: string,
		coreUserId?: string
	): Promise<TemporaryRoleAssignment[]> {
		await this.assertGuild(guildId)
		const now = Date.now()
		if (discordUserId) {
			return this.queryRows(
				`SELECT * FROM temporary_role_assignments WHERE guild_id = ? AND discord_user_id = ? AND status = 'active' AND (expires_at IS NULL OR expires_at > ?)`,
				guildId,
				discordUserId,
				now
			)
		}
		if (coreUserId) {
			return this.queryRows(
				`SELECT * FROM temporary_role_assignments WHERE guild_id = ? AND core_user_id = ? AND status = 'active' AND (expires_at IS NULL OR expires_at > ?)`,
				guildId,
				coreUserId,
				now
			)
		}
		return this.queryRows(
			`SELECT * FROM temporary_role_assignments WHERE guild_id = ? AND status = 'active' AND (expires_at IS NULL OR expires_at > ?)`,
			guildId,
			now
		)
	}

	async listPendingRemovalAssignments(
		guildId: string,
		discordUserId?: string,
		coreUserId?: string
	): Promise<TemporaryRoleAssignment[]> {
		await this.assertGuild(guildId)
		const subjectClause = discordUserId
			? ` AND discord_user_id = ?`
			: coreUserId
				? ` AND core_user_id = ?`
				: ''
		const subject = discordUserId ?? coreUserId
		return this.queryRows(
			`SELECT * FROM temporary_role_assignments WHERE guild_id = ? AND status IN ('removal_pending', 'claimed', 'failed') AND NOT (status = 'failed' AND failure_message = 'removed')${subjectClause}`,
			...(subject ? [guildId, subject] : [guildId])
		)
	}

	async upsertAssignment(
		guildId: string,
		input: TemporaryRoleAssignmentInput
	): Promise<TemporaryRoleAssignment> {
		await this.assertGuild(guildId)
		if (input.guildId !== guildId) throw new Error('Assignment guild mismatch')
		const now = Date.now()
		if (input.interactionId) {
			const existingByInteraction = this.queryRows(
				`SELECT * FROM temporary_role_assignments WHERE interaction_id = ?`,
				input.interactionId
			)[0]
			if (existingByInteraction) return existingByInteraction
		}

		const existing = this.queryRows(
			`SELECT * FROM temporary_role_assignments WHERE guild_id = ? AND role_id = ? AND discord_user_id = ? AND status IN ('active', 'claimed', 'removal_pending') LIMIT 1`,
			guildId,
			input.roleId,
			input.discordUserId
		)[0]
		if (existing && existing.assignmentSource === 'admin' && input.assignmentSource === 'self') {
			return existing
		}
		if (existing) {
			const revision = await this.nextRevision()
			this.state.storage.sql.exec(
				`UPDATE temporary_role_assignments SET role_name = ?, core_user_id = ?, assigned_by_core_user_id = ?, assignment_source = ?, assigned_at = ?, expires_at = ?, status = 'active', removal_reason = NULL, attempt_count = 0, next_attempt_at = NULL, failure_message = NULL, failure_expires_at = NULL, interaction_id = ?, revision = ? WHERE id = ?`,
				input.roleName,
				input.coreUserId ?? null,
				input.assignedByCoreUserId ?? null,
				input.assignmentSource,
				now,
				input.expiresAt,
				input.interactionId ?? null,
				revision,
				existing.id
			)
			await this.rescheduleAlarm()
			return this.queryRows(`SELECT * FROM temporary_role_assignments WHERE id = ?`, existing.id)[0]
		}

		const id = crypto.randomUUID()
		const revision = await this.nextRevision()
		this.state.storage.sql.exec(
			`INSERT INTO temporary_role_assignments (id, guild_id, role_id, role_name, discord_user_id, core_user_id, assigned_by_core_user_id, assignment_source, assigned_at, expires_at, revision, interaction_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			id,
			guildId,
			input.roleId,
			input.roleName,
			input.discordUserId,
			input.coreUserId ?? null,
			input.assignedByCoreUserId ?? null,
			input.assignmentSource,
			now,
			input.expiresAt,
			revision,
			input.interactionId ?? null
		)
		await this.rescheduleAlarm()
		return this.queryRows(`SELECT * FROM temporary_role_assignments WHERE id = ?`, id)[0]
	}

	async markRemovalPending(
		guildId: string,
		input: { roleId: string; discordUserId: string; reason: string; onlySelf?: boolean }
	): Promise<TemporaryRoleAssignment | null> {
		await this.assertGuild(guildId)
		const sourceClause = input.onlySelf ? ` AND assignment_source = 'self'` : ''
		const existing = this.queryRows(
			`SELECT * FROM temporary_role_assignments WHERE guild_id = ? AND role_id = ? AND discord_user_id = ? AND status IN ('active', 'claimed', 'failed') AND NOT (status = 'failed' AND failure_message = 'removed')${sourceClause} ORDER BY revision DESC LIMIT 1`,
			guildId,
			input.roleId,
			input.discordUserId
		)[0]
		if (!existing) return null
		const revision = await this.nextRevision()
		this.state.storage.sql.exec(
			`UPDATE temporary_role_assignments SET status = 'removal_pending', removal_reason = ?, next_attempt_at = ?, attempt_count = 0, revision = ? WHERE id = ?`,
			input.reason,
			Date.now(),
			revision,
			existing.id
		)
		await this.rescheduleAlarm()
		return this.queryRows(`SELECT * FROM temporary_role_assignments WHERE id = ?`, existing.id)[0]
	}

	async applyRoleMutation(
		guildId: string,
		input: {
			roleId: string
			discordUserId: string
			action: 'add' | 'remove'
			revision: number
		}
	): Promise<{ success: boolean; error?: string }> {
		await this.assertGuild(guildId)
		let action = input.action
		let revision = input.revision
		let result: { success: boolean; error?: string } = { success: false }
		const discordStub = getStub<Discord>(this.env.DISCORD, 'default')

		for (let attempt = 0; attempt < 2; attempt++) {
			// Count each Discord mutation attempt so the immediate retry and any
			// alarm-driven retry share one bounded assignment retry budget.
			this.state.storage.sql.exec(
				`UPDATE temporary_role_assignments SET attempt_count = attempt_count + 1 WHERE id = (SELECT id FROM temporary_role_assignments WHERE guild_id = ? AND role_id = ? AND discord_user_id = ? ORDER BY revision DESC LIMIT 1)`,
				guildId,
				input.roleId,
				input.discordUserId
			)
			result =
				action === 'add'
					? await discordStub.addGuildMemberRole(guildId, input.discordUserId, input.roleId)
					: await discordStub.removeGuildMemberRole(guildId, input.discordUserId, input.roleId)
			const latest = this.queryRows(
				`SELECT * FROM temporary_role_assignments WHERE guild_id = ? AND role_id = ? AND discord_user_id = ? ORDER BY revision DESC LIMIT 1`,
				guildId,
				input.roleId,
				input.discordUserId
			)[0]
			const latestRevision = latest?.revision ?? 0
			if (latestRevision <= revision && (result.success || attempt === 1)) return result

			if (latestRevision > revision) {
				revision = latestRevision
				action = latest.status === 'active' ? 'add' : 'remove'
			}
		}

		return result
	}

	async completeRemoval(
		guildId: string,
		removals: Array<{ assignmentId: string; revision?: number }>,
		success: boolean,
		errorMessage?: string
	): Promise<void> {
		await this.assertGuild(guildId)
		for (const removal of removals) {
			const id = removal.assignmentId
			const row = this.queryRows(
				`SELECT * FROM temporary_role_assignments WHERE guild_id = ? AND id = ?`,
				guildId,
				id
			)[0]
			if (!row || (removal.revision !== undefined && row.revision !== removal.revision)) continue
			if (success) {
				this.state.storage.sql.exec(
					`UPDATE temporary_role_assignments SET status = 'failed', failure_message = 'removed', failure_expires_at = ?, next_attempt_at = NULL WHERE guild_id = ? AND id = ?`,
					Date.now() + REMOVAL_TOMBSTONE_RETENTION_MS,
					guildId,
					id
				)
				continue
			}
			if (row.attemptCount < 2) {
				this.state.storage.sql.exec(
					`UPDATE temporary_role_assignments SET status = 'removal_pending', next_attempt_at = ?, failure_message = ? WHERE guild_id = ? AND id = ?`,
					Date.now() + RETRY_DELAY_MS,
					errorMessage ?? 'Temporary role removal failed; retrying',
					guildId,
					id
				)
			} else {
				this.state.storage.sql.exec(
					`UPDATE temporary_role_assignments SET status = 'failed', failure_message = ?, failure_expires_at = ?, next_attempt_at = NULL WHERE guild_id = ? AND id = ?`,
					errorMessage ?? 'Temporary role removal failed',
					Date.now() + FAILURE_RETENTION_MS,
					guildId,
					id
				)
			}
		}
		await this.rescheduleAlarm()
	}

	async deleteAssignment(guildId: string, assignmentId: string): Promise<void> {
		await this.assertGuild(guildId)
		this.state.storage.sql.exec(
			`UPDATE temporary_role_assignments SET status = 'failed', failure_message = 'removed', failure_expires_at = ?, next_attempt_at = NULL WHERE guild_id = ? AND id = ?`,
			Date.now() + REMOVAL_TOMBSTONE_RETENTION_MS,
			guildId,
			assignmentId
		)
		await this.rescheduleAlarm()
	}

	async restoreAssignment(
		guildId: string,
		assignmentId: string,
		expectedRevision: number,
		previous: Pick<
			TemporaryRoleAssignment,
			'assignedAt' | 'expiresAt' | 'assignmentSource' | 'coreUserId' | 'assignedByCoreUserId'
		>
	): Promise<void> {
		await this.assertGuild(guildId)
		const revision = await this.nextRevision()
		this.state.storage.sql.exec(
			`UPDATE temporary_role_assignments SET assigned_at = ?, expires_at = ?, core_user_id = ?, assigned_by_core_user_id = ?, assignment_source = ?, status = 'active', removal_reason = NULL, attempt_count = 0, next_attempt_at = NULL, failure_message = NULL, failure_expires_at = NULL, revision = ? WHERE guild_id = ? AND id = ? AND revision = ?`,
			previous.assignedAt,
			previous.expiresAt,
			previous.coreUserId,
			previous.assignedByCoreUserId,
			previous.assignmentSource,
			revision,
			guildId,
			assignmentId,
			expectedRevision
		)
		await this.rescheduleAlarm()
	}

	async reschedule(guildId: string): Promise<void> {
		await this.assertGuild(guildId)
		await this.rescheduleAlarm()
	}

	private async rescheduleAlarm(): Promise<void> {
		const now = Date.now()
		this.state.storage.sql.exec(
			`DELETE FROM temporary_role_assignments WHERE status = 'failed' AND failure_expires_at IS NOT NULL AND failure_expires_at <= ?`,
			now
		)
		const next = this.state.storage.sql
			.exec<{
				due_at: number | null
			}>(
				`SELECT MIN(due_at) AS due_at FROM (SELECT expires_at AS due_at FROM temporary_role_assignments WHERE status = 'active' AND expires_at IS NOT NULL UNION ALL SELECT next_attempt_at AS due_at FROM temporary_role_assignments WHERE status IN ('removal_pending', 'failed') AND next_attempt_at IS NOT NULL UNION ALL SELECT next_attempt_at AS due_at FROM temporary_role_assignments WHERE status = 'claimed' AND next_attempt_at IS NOT NULL UNION ALL SELECT failure_expires_at AS due_at FROM temporary_role_assignments WHERE status = 'failed' AND failure_expires_at IS NOT NULL)`
			)
			.toArray()[0]
		if (next?.due_at === null || next?.due_at === undefined) {
			await this.state.storage.deleteAlarm()
			return
		}
		await this.state.storage.setAlarm(Math.max(now + 1000, next.due_at))
	}

	async alarm(): Promise<void> {
		const guildId = await this.state.storage.get<string>(GUILD_ID_STORAGE_KEY)
		if (!guildId) {
			await this.state.storage.deleteAlarm()
			return
		}
		const now = Date.now()
		const due = this.queryRows(
			`SELECT * FROM temporary_role_assignments WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at <= ? LIMIT 100`,
			now
		)
		for (const assignment of due) {
			const revision = await this.nextRevision()
			this.state.storage.sql.exec(
				`UPDATE temporary_role_assignments SET status = 'removal_pending', removal_reason = 'expired', next_attempt_at = ?, attempt_count = 0, revision = ? WHERE id = ? AND status = 'active'`,
				now,
				revision,
				assignment.id
			)
		}

		const pending = this.queryRows(
			`SELECT * FROM temporary_role_assignments WHERE status IN ('removal_pending', 'claimed') AND next_attempt_at IS NOT NULL AND next_attempt_at <= ? LIMIT 100`,
			now
		)
		const linked = new Map<string, Array<{ assignmentId: string; revision: number }>>()
		for (const assignment of pending) {
			if (assignment.coreUserId) {
				const ids = linked.get(assignment.coreUserId) ?? []
				ids.push({ assignmentId: assignment.id, revision: assignment.revision })
				linked.set(assignment.coreUserId, ids)
				this.state.storage.sql.exec(
					`UPDATE temporary_role_assignments SET status = 'claimed', attempt_count = attempt_count + 1, next_attempt_at = ? WHERE id = ?`,
					now + CLAIM_LEASE_MS,
					assignment.id
				)
				continue
			}

			this.state.storage.sql.exec(
				`UPDATE temporary_role_assignments SET status = 'claimed', attempt_count = attempt_count + 1, next_attempt_at = ? WHERE id = ?`,
				now + CLAIM_LEASE_MS,
				assignment.id
			)
			const result = await this.applyRoleMutation(guildId, {
				roleId: assignment.roleId,
				discordUserId: assignment.discordUserId,
				action: 'remove',
				revision: assignment.revision,
			})
			await this.completeRemoval(
				guildId,
				[{ assignmentId: assignment.id, revision: assignment.revision }],
				result.success,
				result.error
			)
		}

		for (const [coreUserId, assignmentIds] of linked) {
			try {
				await createWorkflow(this.env.USER_DISCORD_REFRESH_WORKFLOW, {
					id: `temporary-role-expiry-${guildId}-${coreUserId}-${Date.now().toString(36)}`,
					params: {
						userId: coreUserId,
						source: 'temporary-role-expiry',
						allowRemoval: true,
						temporaryRoleRemovalsByGuild: { [guildId]: assignmentIds },
					},
				})
			} catch (error) {
				await this.completeRemoval(guildId, assignmentIds, false, String(error))
			}
		}
		await this.rescheduleAlarm()
	}
}
