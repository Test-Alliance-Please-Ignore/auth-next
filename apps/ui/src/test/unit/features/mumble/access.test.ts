import { describe, expect, it } from 'vitest'

import { ROLE_CORE_ALLIANCE_MEMBER } from '@repo/core'

import { canAccessMumble } from '@/features/mumble/access'

describe('canAccessMumble', () => {
	it('allows users with the persisted alliance-member role', () => {
		expect(canAccessMumble({ roles: [ROLE_CORE_ALLIANCE_MEMBER] })).toBe(true)
	})

	it('allows site administrators like the backend route guard', () => {
		expect(canAccessMumble({ is_admin: true, roles: [] })).toBe(true)
	})

	it('denies authenticated users without the alliance capability', () => {
		expect(canAccessMumble({ is_admin: false, roles: [] })).toBe(false)
		expect(canAccessMumble(null)).toBe(false)
	})
})
