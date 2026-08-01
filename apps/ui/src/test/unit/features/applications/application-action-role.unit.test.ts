import { describe, expect, it } from 'vitest'

import { resolveApplicationActionRole } from '../../../../client/features/applications/utils/application-action-role'

describe('resolveApplicationActionRole', () => {
	it('gives site admins HR admin actions without a permission request result', () => {
		expect(
			resolveApplicationActionRole({
				isSiteAdmin: true,
				corporationRole: 'admin',
				permissionRole: null,
			})
		).toBe('hr_admin')
	})

	it('uses the corporation access role when the permission result is unavailable', () => {
		expect(
			resolveApplicationActionRole({
				isSiteAdmin: false,
				corporationRole: 'hr_reviewer',
				permissionRole: null,
			})
		).toBe('hr_reviewer')
	})

	it('preserves the permission result for regular HR roles', () => {
		expect(
			resolveApplicationActionRole({
				isSiteAdmin: false,
				corporationRole: 'CEO',
				permissionRole: 'hr_admin',
			})
		).toBe('hr_admin')
	})

	it('does not grant actions to leadership without an HR role', () => {
		expect(
			resolveApplicationActionRole({
				isSiteAdmin: false,
				corporationRole: 'Director',
				permissionRole: null,
			})
		).toBeNull()
	})
})
