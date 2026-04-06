import { describe, expect, it } from 'vitest'

import {
	buildBroadcastPermissionContext,
	canAccessBroadcastPermissionId,
	filterBroadcastTargetsByAction,
} from '../broadcasts-permissions'

import type { BroadcastTarget } from '@repo/broadcasts'
import type { PermissionWithDetails, UserPermission } from '@repo/groups'

function makeUserPermission(
	urn: string,
	groupId: string,
	groupName: string,
	source: 'global' | 'group_scoped' = 'global'
): UserPermission {
	return {
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

function makeGlobalPermission(id: string, urn: string): PermissionWithDetails {
	const now = new Date()
	return {
		id,
		urn,
		name: urn,
		description: null,
		categoryId: null,
		createdBy: 'seed',
		createdAt: now,
		updatedAt: now,
		category: null,
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
	it('consolidates duplicate permission attachments from multiple groups', () => {
		const userPermissions: UserPermission[] = [
			makeUserPermission('urn:broadcasts:alliance:alliance-members:send', 'group-1', 'Group One'),
			makeUserPermission('urn:broadcasts:alliance:alliance-members:send', 'group-2', 'Group Two'),
		]
		const globalPermissions: PermissionWithDetails[] = [
			makeGlobalPermission(
				'perm-alliance-members-send',
				'urn:broadcasts:alliance:alliance-members:send'
			),
		]

		const context = buildBroadcastPermissionContext(userPermissions, globalPermissions)

		expect(canAccessBroadcastPermissionId('perm-alliance-members-send', 'send', context)).toBe(true)
		expect(canAccessBroadcastPermissionId('perm-alliance-members-send', 'manage', context)).toBe(
			false
		)
	})

	it('treats manage as superset of send for the same broadcast scope key', () => {
		const userPermissions: UserPermission[] = [
			makeUserPermission(
				'urn:broadcasts:alliance:alliance-members:manage',
				'group-9',
				'Group Nine'
			),
		]
		const globalPermissions: PermissionWithDetails[] = [
			makeGlobalPermission(
				'perm-alliance-members-send',
				'urn:broadcasts:alliance:alliance-members:send'
			),
			makeGlobalPermission(
				'perm-alliance-members-manage',
				'urn:broadcasts:alliance:alliance-members:manage'
			),
		]

		const context = buildBroadcastPermissionContext(userPermissions, globalPermissions)

		expect(canAccessBroadcastPermissionId('perm-alliance-members-send', 'send', context)).toBe(true)
		expect(canAccessBroadcastPermissionId('perm-alliance-members-send', 'manage', context)).toBe(
			true
		)
		expect(canAccessBroadcastPermissionId('perm-alliance-members-manage', 'send', context)).toBe(
			true
		)
		expect(canAccessBroadcastPermissionId('perm-alliance-members-manage', 'manage', context)).toBe(
			true
		)
	})

	it('does not grant manage when user only has send for the same scope key', () => {
		const userPermissions: UserPermission[] = [
			makeUserPermission('urn:broadcasts:alliance:alliance-members:send', 'group-4', 'Group Four'),
		]
		const globalPermissions: PermissionWithDetails[] = [
			makeGlobalPermission(
				'perm-alliance-members-send',
				'urn:broadcasts:alliance:alliance-members:send'
			),
			makeGlobalPermission(
				'perm-alliance-members-manage',
				'urn:broadcasts:alliance:alliance-members:manage'
			),
		]

		const context = buildBroadcastPermissionContext(userPermissions, globalPermissions)

		expect(canAccessBroadcastPermissionId('perm-alliance-members-send', 'send', context)).toBe(true)
		expect(canAccessBroadcastPermissionId('perm-alliance-members-manage', 'send', context)).toBe(
			true
		)
		expect(canAccessBroadcastPermissionId('perm-alliance-members-send', 'manage', context)).toBe(
			false
		)
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
			makeUserPermission('urn:broadcasts:alliance:alliance-members:manage', 'group-1', 'Group One'),
			makeUserPermission('urn:broadcasts:alliance:alliance-members:manage', 'group-2', 'Group Two'),
			makeUserPermission('urn:broadcasts:alliance:fleet-command:send', 'group-3', 'Group Three'),
			makeUserPermission(
				'urn:broadcasts:alliance:custom-only:send',
				'group-4',
				'Group Four',
				'group_scoped'
			),
		]

		const globalPermissions: PermissionWithDetails[] = [
			makeGlobalPermission(
				'perm-alliance-members-send',
				'urn:broadcasts:alliance:alliance-members:send'
			),
			makeGlobalPermission(
				'perm-alliance-members-manage',
				'urn:broadcasts:alliance:alliance-members:manage'
			),
			makeGlobalPermission('perm-fleet-command-send', 'urn:broadcasts:alliance:fleet-command:send'),
			makeGlobalPermission('perm-scouts-send', 'urn:broadcasts:alliance:scouts:send'),
		]

		const context = buildBroadcastPermissionContext(userPermissions, globalPermissions)
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
		])
	})

	it('ignores broadcast URNs with invalid namespace or target characters', () => {
		const userPermissions: UserPermission[] = [
			makeUserPermission('urn:broadcasts:test alliance:ops-casual:send', 'group-1', 'Group One'),
			makeUserPermission('urn:broadcasts:test-alliance:ops casual:manage', 'group-1', 'Group One'),
		]
		const globalPermissions: PermissionWithDetails[] = [
			makeGlobalPermission('perm-ops-casual-send', 'urn:broadcasts:test-alliance:ops-casual:send'),
		]

		const context = buildBroadcastPermissionContext(userPermissions, globalPermissions)

		expect(canAccessBroadcastPermissionId('perm-ops-casual-send', 'send', context)).toBe(false)
	})

	it('grants send/manage access to all broadcast permission IDs with global manage URN', () => {
		const userPermissions: UserPermission[] = [
			makeUserPermission('urn:broadcasts:manage', 'group-1', 'Group One'),
		]
		const globalPermissions: PermissionWithDetails[] = [
			makeGlobalPermission('perm-a-send', 'urn:broadcasts:test-alliance:ops-casual:send'),
			makeGlobalPermission('perm-a-manage', 'urn:broadcasts:test-alliance:ops-casual:manage'),
		]

		const context = buildBroadcastPermissionContext(userPermissions, globalPermissions)

		expect(canAccessBroadcastPermissionId('perm-a-send', 'send', context)).toBe(true)
		expect(canAccessBroadcastPermissionId('perm-a-send', 'manage', context)).toBe(true)
		expect(canAccessBroadcastPermissionId('perm-a-manage', 'send', context)).toBe(true)
		expect(canAccessBroadcastPermissionId('perm-a-manage', 'manage', context)).toBe(true)
	})
})
