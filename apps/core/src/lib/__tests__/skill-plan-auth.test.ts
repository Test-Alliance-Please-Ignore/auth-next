import { beforeEach, describe, expect, it, vi } from 'vitest'

import { canModifyPlan, canViewPlan } from '../skill-plan-auth'

const { getCachedUserMemberships, getCachedUserPermissions } = vi.hoisted(() => ({
	getCachedUserMemberships: vi.fn(),
	getCachedUserPermissions: vi.fn(),
}))

vi.mock('../groups-cache', () => ({
	getCachedUserMemberships,
	getCachedUserPermissions,
}))

const env = { GROUPS: {} as DurableObjectNamespace }
const draftPlan = {
	maintainerId: 'maintainer-1',
	isPublished: false,
}

describe('skill plan visibility authorization', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		getCachedUserPermissions.mockResolvedValue([])
		getCachedUserMemberships.mockResolvedValue([])
	})

	it('allows site admins to view unpublished plans', async () => {
		await expect(canViewPlan(draftPlan, 'admin-1', env, true)).resolves.toBe(true)
	})

	it('allows manage-all users to view unpublished plans', async () => {
		getCachedUserPermissions.mockResolvedValue([{ urn: 'urn:skill-plans:manage-all' }])

		await expect(canViewPlan(draftPlan, 'manager-1', env)).resolves.toBe(true)
	})

	it('does not expose unrelated unpublished plans', async () => {
		await expect(canViewPlan(draftPlan, 'other-user', env)).resolves.toBe(false)
	})

	it('allows the maintainer to view and modify an unpublished plan', async () => {
		await expect(canViewPlan(draftPlan, 'maintainer-1', env)).resolves.toBe(true)
		await expect(canModifyPlan(draftPlan, 'maintainer-1', env)).resolves.toBe(true)
	})
})
