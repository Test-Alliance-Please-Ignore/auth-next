import { describe, expect, it } from 'vitest'

import { getBroadcastActionVisibility } from '@/lib/broadcast-permissions'

import type { User } from '@/hooks/useAuth'
import type { Broadcast, BroadcastTarget, UserPermission } from '@/lib/api'

function makeUser(overrides: Partial<User> = {}): User {
	return {
		id: 'user-1',
		mainCharacterId: '7001',
		characters: [],
		is_admin: false,
		...overrides,
	}
}

function makePermission(overrides: Partial<UserPermission> = {}): UserPermission {
	return {
		urn: 'urn:broadcasts:test:test:send',
		name: 'Test',
		description: null,
		category: null,
		groupId: 'group-1',
		groupName: 'Group 1',
		targetType: 'all_members',
		source: 'global',
		...overrides,
	}
}

function makeBroadcast(overrides: Partial<Broadcast> = {}): Broadcast {
	const now = new Date().toISOString()

	return {
		id: 'broadcast-1',
		templateId: null,
		targetId: 'target-1',
		title: 'Test',
		content: {},
		status: 'sent',
		scheduledFor: null,
		sentAt: now,
		errorMessage: null,
		permissionId: 'perm-target-send',
		createdBy: 'owner-1',
		createdByCharacterName: 'Owner',
		createdAt: now,
		updatedAt: now,
		...overrides,
	}
}

function makeTarget(overrides: Partial<BroadcastTarget> = {}): BroadcastTarget {
	const now = new Date().toISOString()
	return {
		id: 'target-1',
		name: 'Target 1',
		description: null,
		type: 'discord_channel',
		sendPermissionId: 'perm-target-send',
		managePermissionId: 'perm-target-manage',
		config: { guildId: 'g', channelId: 'c' },
		createdBy: 'user-1',
		createdAt: now,
		updatedAt: now,
		...overrides,
	}
}

describe('getBroadcastActionVisibility', () => {
	it('shows delete and rescind for target-manage permission holders', () => {
		const visibility = getBroadcastActionVisibility({
			user: makeUser({ id: 'user-2' }),
			permissions: [makePermission({ permissionId: 'perm-target-manage' })],
			broadcast: makeBroadcast({ createdBy: 'owner-1', status: 'sent' }),
			target: makeTarget(),
		})

		expect(visibility).toEqual({ canDelete: true, canRescind: true })
	})

	it('hides delete for send-only users and allows rescind on own sent broadcasts', () => {
		const visibility = getBroadcastActionVisibility({
			user: makeUser({ id: 'owner-1' }),
			permissions: [makePermission({ permissionId: 'perm-target-send' })],
			broadcast: makeBroadcast({ createdBy: 'owner-1', status: 'sent' }),
			target: makeTarget(),
		})

		expect(visibility).toEqual({ canDelete: false, canRescind: true })
	})

	it('hides rescind for non-owner send-only users', () => {
		const visibility = getBroadcastActionVisibility({
			user: makeUser({ id: 'user-send-only' }),
			permissions: [makePermission({ permissionId: 'perm-target-send' })],
			broadcast: makeBroadcast({ createdBy: 'owner-1', status: 'sent' }),
			target: makeTarget(),
		})

		expect(visibility).toEqual({ canDelete: false, canRescind: false })
	})

	it('allows manage actions with global broadcasts manage URN', () => {
		const visibility = getBroadcastActionVisibility({
			user: makeUser({ id: 'user-global' }),
			permissions: [makePermission({ urn: 'urn:broadcasts:manage', permissionId: null })],
			broadcast: makeBroadcast({ createdBy: 'owner-1', status: 'sent' }),
			target: makeTarget(),
		})

		expect(visibility).toEqual({ canDelete: true, canRescind: true })
	})
})
