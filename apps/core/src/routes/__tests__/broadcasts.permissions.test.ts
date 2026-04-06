import { describe, expect, it } from 'vitest'

import {
	buildBroadcastPermissionContext,
	canAccessBroadcastPermissionId,
	filterBroadcastTargetsByAction,
} from '../broadcasts-permissions'

import type { BroadcastTarget } from '@repo/broadcasts'
import type { UserPermission } from '@repo/groups'

function makeUserPermission(
	permissionId: string | null,
	urn: string,
	groupId: string,
	groupName: string,
	source: 'global' | 'group_scoped' = 'global'
): UserPermission {
	return {
		permissionId,
		urn,
		name: urn,
		description: null,
		category: null,
		groupId,
		groupName,
		targetType: 'all_members',
		source,
	}
}

function makeTarget(
	id: string,
	sendPermissionId: string,
	managePermissionId = sendPermissionId
): BroadcastTarget {
	return {
		id,
		name: `Target ${id}`,
		description: null,
		type: 'discord_channel',
		sendPermissionId,
		managePermissionId,
		config: { guildId: 'g', channelId: 'c' },
		createdBy: 'user-1',
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
	}
}

describe('broadcast permission resolution', () => {
	it('consolidates duplicate permission IDs from multiple groups', () => {
		const userPermissions: UserPermission[] = [
			makeUserPermission(
				'perm-alliance-members-send',
				'urn:broadcasts:alliance:alliance-members:send',
				'group-1',
				'Group One'
			),
			makeUserPermission(
				'perm-alliance-members-send',
				'urn:broadcasts:alliance:alliance-members:send',
				'group-2',
				'Group Two'
			),
		]
		const context = buildBroadcastPermissionContext(userPermissions)

		expect(canAccessBroadcastPermissionId('perm-alliance-members-send', 'send', context)).toBe(true)
		expect(canAccessBroadcastPermissionId('perm-alliance-members-send', 'manage', context)).toBe(true)
	})

	it('checks exact permission IDs and does not infer by URN scope/action', () => {
		const userPermissions: UserPermission[] = [
			makeUserPermission(
				'perm-alliance-members-manage',
				'urn:broadcasts:alliance:alliance-members:manage',
				'group-9',
				'Group Nine'
			),
		]
		const context = buildBroadcastPermissionContext(userPermissions)

		expect(canAccessBroadcastPermissionId('perm-alliance-members-send', 'send', context)).toBe(false)
		expect(canAccessBroadcastPermissionId('perm-alliance-members-send', 'manage', context)).toBe(
			false
		)
		expect(canAccessBroadcastPermissionId('perm-alliance-members-manage', 'send', context)).toBe(
			true
		)
		expect(canAccessBroadcastPermissionId('perm-alliance-members-manage', 'manage', context)).toBe(
			true
		)
	})

	it('ignores group-scoped permissions without a global permission ID', () => {
		const userPermissions: UserPermission[] = [
			makeUserPermission(
				null,
				'urn:broadcasts:alliance:alliance-members:send',
				'group-4',
				'Group Four',
				'group_scoped'
			),
		]
		const context = buildBroadcastPermissionContext(userPermissions)

		expect(canAccessBroadcastPermissionId('perm-alliance-members-send', 'send', context)).toBe(false)
		expect(canAccessBroadcastPermissionId('perm-alliance-members-manage', 'send', context)).toBe(
			false
		)
		expect(canAccessBroadcastPermissionId('perm-alliance-members-send', 'manage', context)).toBe(false)
		expect(canAccessBroadcastPermissionId('perm-alliance-members-manage', 'manage', context)).toBe(
			false
		)
	})

	it('derives available targets from consolidated permissions, gates by action, and deduplicates rows', () => {
		const targets: BroadcastTarget[] = [
			makeTarget('target-alliance-send', 'perm-alliance-members-send'),
			makeTarget('target-alliance-send', 'perm-alliance-members-send'), // duplicate row
			makeTarget(
				'target-alliance-manage-id',
				'perm-alliance-members-send',
				'perm-alliance-members-manage'
			),
			makeTarget('target-fc-send', 'perm-fleet-command-send'),
			makeTarget('target-scout-send', 'perm-scouts-send'),
		]

		const userPermissions: UserPermission[] = [
			makeUserPermission(
				'perm-alliance-members-send',
				'urn:broadcasts:alliance:alliance-members:send',
				'group-1',
				'Group One'
			),
			makeUserPermission(
				'perm-alliance-members-manage',
				'urn:broadcasts:alliance:alliance-members:manage',
				'group-2',
				'Group Two'
			),
			makeUserPermission(
				'perm-fleet-command-send',
				'urn:broadcasts:alliance:fleet-command:send',
				'group-3',
				'Group Three'
			),
			makeUserPermission(
				null,
				'urn:broadcasts:alliance:custom-only:send',
				'group-4',
				'Group Four',
				'group_scoped'
			),
		]

		const context = buildBroadcastPermissionContext(userPermissions)
		const sendTargets = filterBroadcastTargetsByAction(targets, 'send', context)
		const manageTargets = filterBroadcastTargetsByAction(targets, 'manage', context)

		expect(sendTargets.map((target) => target.id)).toEqual([
			'target-alliance-send',
			'target-alliance-manage-id',
			'target-fc-send',
		])
		expect(manageTargets.map((target) => target.id)).toEqual([
			'target-alliance-send',
			'target-alliance-manage-id',
			'target-fc-send',
		])
	})

	it('treats target managePermissionId as send-capable when filtering send targets', () => {
		const targets: BroadcastTarget[] = [
			makeTarget('target-manage-only-access', 'perm-send-x', 'perm-manage-x'),
		]
		const userPermissions: UserPermission[] = [
			makeUserPermission(
				'perm-manage-x',
				'urn:broadcasts:alliance:ops:manage',
				'group-1',
				'Group One'
			),
		]

		const context = buildBroadcastPermissionContext(userPermissions)
		const sendTargets = filterBroadcastTargetsByAction(targets, 'send', context)
		const manageTargets = filterBroadcastTargetsByAction(targets, 'manage', context)

		expect(sendTargets.map((target) => target.id)).toEqual(['target-manage-only-access'])
		expect(manageTargets.map((target) => target.id)).toEqual(['target-manage-only-access'])
	})

	it('grants send/manage access to all broadcast permission IDs with global manage URN', () => {
		const userPermissions: UserPermission[] = [
			makeUserPermission(null, 'urn:broadcasts:manage', 'group-1', 'Group One'),
		]

		const context = buildBroadcastPermissionContext(userPermissions)

		expect(canAccessBroadcastPermissionId('perm-a-send', 'send', context)).toBe(true)
		expect(canAccessBroadcastPermissionId('perm-a-send', 'manage', context)).toBe(true)
		expect(canAccessBroadcastPermissionId('perm-a-manage', 'send', context)).toBe(true)
		expect(canAccessBroadcastPermissionId('perm-a-manage', 'manage', context)).toBe(true)
	})
})
