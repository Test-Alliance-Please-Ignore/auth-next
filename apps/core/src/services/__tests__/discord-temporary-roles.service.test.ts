import { describe, expect, it, vi } from 'vitest'

import { ROLE_CORE_ALLIANCE_MEMBER } from '@repo/core'

import { hasAllianceMemberRole } from '../discord-temporary-roles.service'

const { getCachedUserRoles } = vi.hoisted(() => ({
	getCachedUserRoles: vi.fn(),
}))

vi.mock('../../lib/groups-cache', () => ({
	getCachedUserRoles,
}))

describe('temporary role permission resolution', () => {
	it('recognizes the alliance member role attachment', async () => {
		getCachedUserRoles.mockResolvedValue([
			{ role: { name: 'Unrelated Role' } },
			{ role: { name: ROLE_CORE_ALLIANCE_MEMBER } },
		])

		const env = { GROUPS: {} } as unknown as { GROUPS: DurableObjectNamespace }
		expect(await hasAllianceMemberRole(env, 'core-user-1')).toBe(true)
		expect(getCachedUserRoles).toHaveBeenCalledWith(env, 'core-user-1')
	})

	it('does not grant access based on unrelated roles or missing role data', async () => {
		getCachedUserRoles.mockResolvedValue([{ role: { name: 'Unrelated Role' } }, { role: null }])

		expect(await hasAllianceMemberRole({ GROUPS: {} } as unknown as { GROUPS: DurableObjectNamespace }, 'core-user-2')).toBe(false)
	})
})
