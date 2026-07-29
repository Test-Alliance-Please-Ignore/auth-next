import { describe, expect, it } from 'vitest'

import { userHasPermission } from './permission-target'

describe('userHasPermission', () => {
	it('grants all members regardless of role', () => {
		expect(userHasPermission('all_members', false, false)).toBe(true)
	})

	it('grants all-admin permissions only to admins', () => {
		expect(userHasPermission('all_admins', false, false)).toBe(false)
		expect(userHasPermission('all_admins', false, true)).toBe(true)
	})

	it('grants owner-only permissions only to the owner', () => {
		expect(userHasPermission('owner_only', false, true)).toBe(false)
		expect(userHasPermission('owner_only', true, false)).toBe(true)
	})

	it('grants owner-and-admin permissions to either role', () => {
		expect(userHasPermission('owner_and_admins', false, false)).toBe(false)
		expect(userHasPermission('owner_and_admins', true, false)).toBe(true)
		expect(userHasPermission('owner_and_admins', false, true)).toBe(true)
	})
})
