import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

import { getStub } from '@repo/do-utils'

import type { Env } from '../../context'
import type { TemporaryRoleAssignments } from '../../temporary-role-assignments-do'

const testEnv = env as unknown as Env

function assignmentsFor(guildId: string): TemporaryRoleAssignments {
	return getStub<TemporaryRoleAssignments>(testEnv.TEMPORARY_ROLE_ASSIGNMENTS, guildId)
}

describe('TemporaryRoleAssignments Durable Object', () => {
	it('persists active assignments and transitions them to pending removal', async () => {
		const guildId = `guild-persistence-${crypto.randomUUID()}`
		const assignments = assignmentsFor(guildId)

		const created = await assignments.upsertAssignment(guildId, {
			guildId,
			roleId: 'role-1',
			roleName: 'Fleet Member',
			discordUserId: 'discord-user-1',
			coreUserId: 'core-user-1',
			assignmentSource: 'self',
			expiresAt: Date.now() + 60_000,
		})

		expect(await assignments.listActiveAssignments(guildId, undefined, 'core-user-1')).toHaveLength(
			1
		)
		const pending = await assignments.markRemovalPending(guildId, {
			roleId: 'role-1',
			discordUserId: 'discord-user-1',
			reason: 'part',
			onlySelf: true,
		})

		expect(pending?.id).toBe(created.id)
		expect(await assignments.listActiveAssignments(guildId, undefined, 'core-user-1')).toHaveLength(
			0
		)
		expect(
			await assignments.listPendingRemovalAssignments(guildId, undefined, 'core-user-1')
		).toHaveLength(1)

		await assignments.completeRemoval(
			guildId,
			[{ assignmentId: created.id, revision: pending!.revision }],
			true
		)
		expect(
			await assignments.listPendingRemovalAssignments(guildId, undefined, 'core-user-1')
		).toHaveLength(0)
	})

	it('renews an active assignment immediately instead of debouncing the duration reset', async () => {
		const guildId = `guild-renewal-${crypto.randomUUID()}`
		const assignments = assignmentsFor(guildId)
		const first = await assignments.upsertAssignment(guildId, {
			guildId,
			roleId: 'role-renewal',
			roleName: 'Renewable Role',
			discordUserId: 'discord-renewal',
			assignmentSource: 'self',
			expiresAt: Date.now() + 60_000,
		})
		const renewed = await assignments.upsertAssignment(guildId, {
			guildId,
			roleId: 'role-renewal',
			roleName: 'Renewable Role',
			discordUserId: 'discord-renewal',
			assignmentSource: 'self',
			expiresAt: Date.now() + 120_000,
		})

		expect(renewed.id).toBe(first.id)
		expect(renewed.revision).toBeGreaterThan(first.revision)
		expect(renewed.expiresAt).toBeGreaterThan(first.expiresAt!)
		await assignments.restoreAssignment(guildId, first.id, first.revision, first)
		const current = await assignments.listActiveAssignments(guildId, 'discord-renewal')
		expect(current[0]?.revision).toBe(renewed.revision)
		expect(current[0]?.expiresAt).toBe(renewed.expiresAt)
	})

	it('retains failed removals for alarm retry and explicit eviction handling', async () => {
		const guildId = `guild-retry-${crypto.randomUUID()}`
		const assignments = assignmentsFor(guildId)
		const created = await assignments.upsertAssignment(guildId, {
			guildId,
			roleId: 'role-2',
			roleName: 'Fleet Support',
			discordUserId: 'discord-user-2',
			assignmentSource: 'admin',
			expiresAt: Date.now() + 60_000,
		})
		const pending = await assignments.markRemovalPending(guildId, {
			roleId: 'role-2',
			discordUserId: 'discord-user-2',
			reason: 'unset',
		})

		await assignments.completeRemoval(
			guildId,
			[{ assignmentId: created.id, revision: pending!.revision }],
			false,
			'Discord unavailable'
		)
		const retry = await assignments.listPendingRemovalAssignments(guildId, 'discord-user-2')
		expect(retry[0]?.status).toBe('removal_pending')
		await assignments.deleteAssignment(guildId, created.id)
		expect(await assignments.listPendingRemovalAssignments(guildId, 'discord-user-2')).toHaveLength(
			0
		)
	})
})
